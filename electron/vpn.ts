// Connection state machine, health monitoring, kill switch and traffic accounting.

import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import type {
  Profile,
  PublicIpInfo,
  SpeedTestResult,
  TrafficSample,
  TrafficSnapshot,
  VpnState,
} from "../shared/types";
import { ClashApi, CoreProcess, corePath, freePort, randomSecret } from "./core";
import { buildBlockerConfig, buildTunnelConfig, PROXY_TAG } from "./singbox-config";
import { Store, todayKey } from "./store";

const HEALTH_INTERVAL = 10_000;
const HEALTH_FAILS_BEFORE_DOWN = 2;
/** Delay before each reconnect attempt (the last value repeats when the kill switch is on). */
const BACKOFF = [3_000, 5_000, 10_000, 15_000, 30_000];
const MAX_RECONNECTS = 5;
const HISTORY = 120;

/** Turns raw core / network errors into a short sentence for the UI. */
export function friendlyError(raw: string): string {
  const r = raw.toLowerCase();
  if (/unable to authenticate|handshake failed|auth/.test(r)) return "The server rejected the login. Check the username, password or key.";
  if (/timeout|timed out|deadline/.test(r)) return "The server did not respond in time.";
  if (/refused/.test(r)) return "The server refused the connection.";
  if (/no such host|lookup|nxdomain/.test(r)) return "The server address could not be found.";
  if (/reset by peer|eof|broken pipe/.test(r)) return "The connection was interrupted by the network.";
  if (/access is denied|permission|wintun|administrator/.test(r)) return "Windows blocked the network adapter. Run Anti VPN as administrator.";
  return "Could not establish the VPN connection.";
}

type Mode = "tunnel" | "blocker";

export interface VpnEvents {
  state: (s: VpnState) => void;
  traffic: (t: TrafficSnapshot) => void;
  log: (level: "info" | "warn" | "error", msg: string) => void;
  profileUpdated: (p: Profile) => void;
}

export class VpnManager extends EventEmitter {
  state: VpnState = { status: "disconnected", blocking: false };
  private core: CoreProcess | null = null;
  private api: ClashApi | null = null;
  private mode: Mode | null = null;
  /** Profile the user wants to be connected to (null = user wants VPN off). */
  private desired: string | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private healthFails = 0;
  private stopTraffic: (() => void) | null = null;
  private op = 0; // increments on every connect/disconnect so stale async work can bail out
  private busy = false;

  history: TrafficSample[] = [];
  snapshot: TrafficSnapshot | null = null;

  constructor(
    private store: Store,
    private isAdmin: () => boolean,
  ) {
    super();
  }

  private log(level: "info" | "warn" | "error", msg: string) {
    this.emit("log", level, msg);
  }

  private setState(patch: Partial<VpnState>) {
    this.state = { ...this.state, ...patch };
    this.emit("state", this.state);
  }

  private get settings() {
    return this.store.settings.data;
  }

  private profile(id: string | null): Profile | undefined {
    return id ? this.store.profiles.data.find((p) => p.id === id) : undefined;
  }

  // ---------------- public API ----------------

  async connect(profileId: string): Promise<void> {
    const p = this.profile(profileId);
    if (!p) throw new Error("Config not found");
    if (!existsSync(corePath())) throw new Error("CORE_MISSING");
    if (!this.isAdmin()) throw new Error("ADMIN_REQUIRED");

    const op = ++this.op;
    this.desired = profileId;
    this.attempt = 0;
    this.clearTimers();
    this.setState({
      status: "connecting",
      phase: "starting",
      profileId,
      error: undefined,
      errorDetail: undefined,
      reconnect: undefined,
      publicIp: undefined,
    });
    await this.stopCore();
    if (op !== this.op) return;

    p.lastUsedAt = Date.now();
    this.store.settings.data.lastProfileId = p.id;
    this.store.settings.save();
    this.store.profiles.save();
    this.emit("profileUpdated", p);

    await this.bringUp(op, true);
  }

  async disconnect(): Promise<void> {
    const op = ++this.op;
    this.desired = null;
    this.attempt = 0;
    this.clearTimers();
    if (this.state.status !== "disconnected") this.setState({ status: "disconnecting", reconnect: undefined, phase: undefined });
    await this.stopCore();
    if (op !== this.op) return;
    this.endSession();
    this.setState({
      status: "disconnected",
      blocking: false,
      since: undefined,
      publicIp: undefined,
      error: undefined,
      errorDetail: undefined,
      reconnect: undefined,
      phase: undefined,
    });
  }

  /** Skip the countdown and try to reconnect right away. */
  async reconnectNow(): Promise<void> {
    if (!this.desired || this.state.status !== "reconnecting") return;
    const op = ++this.op;
    this.clearTimers();
    await this.stopCore();
    if (op !== this.op) return;
    await this.attemptReconnect(op);
  }

  /** Called when settings that affect the running config change (exceptions, DNS...). */
  async applySettings(): Promise<void> {
    if (!this.desired) return;
    if (this.mode === "blocker" && !this.settings.killSwitch.enabled) {
      // Kill switch turned off while blocking -> release the internet.
      await this.disconnect();
      return;
    }
    if (this.busy) return;
    const op = ++this.op;
    this.log("info", "Settings changed, restarting tunnel");
    this.clearTimers();
    await this.stopCore();
    if (op !== this.op) return;
    await this.bringUp(op, false);
  }

  async shutdown() {
    this.desired = null;
    this.clearTimers();
    await this.stopCore();
    this.endSession();
  }

  // ---------------- internals ----------------

  private attempt = 0;

  private clearTimers() {
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.healthTimer = this.retryTimer = null;
  }

  private async stopCore() {
    this.stopTraffic?.();
    this.stopTraffic = null;
    const c = this.core;
    this.core = null;
    this.api = null;
    this.mode = null;
    if (c) await c.stop();
  }

  private async startCore(mode: Mode, profile?: Profile): Promise<{ ok: boolean; error?: string }> {
    const port = await freePort();
    const secret = randomSecret();
    const opts = { clashPort: port, clashSecret: secret, logLevel: "warn" };
    const config = mode === "tunnel" && profile ? buildTunnelConfig(profile, this.settings, opts) : buildBlockerConfig(this.settings, opts);
    const proc = new CoreProcess({
      exe: corePath(),
      name: mode,
      config,
      onLog: (l) => this.log(/FATAL|ERROR/.test(l) ? "error" : /WARN/.test(l) ? "warn" : "info", l),
      onExit: (code) => this.onCoreExit(proc, code),
    });
    proc.start();
    const api = new ClashApi(port, secret);
    const ready = await api.ready(10000);
    if (!ready || !proc.running) {
      const error = proc.lastError() || "sing-box failed to start";
      await proc.stop();
      return { ok: false, error };
    }
    this.core = proc;
    this.api = api;
    this.mode = mode;
    this.startTrafficStream(api);
    return { ok: true };
  }

  /** Starts the tunnel for `desired` and verifies it. */
  private async bringUp(op: number, initial: boolean) {
    const p = this.profile(this.desired);
    if (!p) return;
    this.busy = true;
    try {
      if (this.state.status !== "reconnecting") this.setState({ phase: "starting" });
      const res = await this.startCore("tunnel", p);
      if (op !== this.op) return;
      if (!res.ok) {
        this.log("error", `Tunnel failed to start: ${res.error}`);
        await this.handleDown(op, friendlyError(res.error ?? ""), res.error ?? "", true, initial);
        return;
      }
      this.log("info", `Tunnel started with "${p.name}"`);
      if (this.state.status !== "reconnecting") this.setState({ phase: "connecting" });
      // Verify the server actually works (the first request also completes the handshake).
      let ms = await this.api!.delay(PROXY_TAG, this.settings.pingUrl, 6000);
      if (op !== this.op) return;
      if (ms < 0) {
        if (this.state.status !== "reconnecting") this.setState({ phase: "verifying" });
        ms = await this.api!.delay(PROXY_TAG, this.settings.pingUrl, 8000);
      }
      if (op !== this.op) return;
      if (ms < 0) {
        const detail = this.core?.lastError() ?? "";
        await this.handleDown(op, detail ? friendlyError(detail) : "The server is not responding.", detail, false, initial);
        return;
      }
      this.onUp(p, ms, initial);
    } finally {
      this.busy = false;
    }
  }

  private onUp(p: Profile, ms: number, fresh: boolean) {
    const wasReconnecting = this.state.status === "reconnecting";
    this.healthFails = 0;
    this.attempt = 0;
    p.ping = ms;
    p.pingAt = Date.now();
    this.emit("profileUpdated", p);
    const since = fresh || !this.state.since ? Date.now() : this.state.since;
    if (fresh) this.resetSession();
    this.setState({
      status: "connected",
      blocking: false,
      error: undefined,
      errorDetail: undefined,
      reconnect: undefined,
      phase: undefined,
      since,
      profileId: p.id,
    });
    if (wasReconnecting) this.log("info", "VPN connection restored");
    this.startHealth();
    void this.refreshPublicIp(p);
  }

  /**
   * The VPN is supposed to be on but isn't working.
   * - First connect attempt with the kill switch off: give up and report the error.
   * - Otherwise: reconnect with backoff. With the kill switch on, traffic stays blocked meanwhile
   *   and retries never stop; with it off, traffic is released and we try MAX_RECONNECTS times.
   */
  private async handleDown(op: number, reason: string, detail: string, coreFailed: boolean, initial: boolean) {
    if (op !== this.op || !this.desired) return;
    const ks = this.settings.killSwitch.enabled;

    if ((initial && !ks) || (!ks && !this.settings.autoReconnect) || (!ks && this.attempt >= MAX_RECONNECTS)) {
      await this.stopCore();
      if (op !== this.op) return;
      this.endSession();
      this.desired = null;
      const gaveUp = !initial && this.attempt >= MAX_RECONNECTS;
      this.setState({
        status: "disconnected",
        blocking: false,
        error: gaveUp ? `Could not reconnect after ${MAX_RECONNECTS} attempts. ${reason}` : reason,
        errorDetail: detail || undefined,
        reconnect: undefined,
        phase: undefined,
        since: undefined,
        publicIp: undefined,
      });
      return;
    }

    if (ks) {
      // Keep traffic blocked: the tunnel fails closed by itself; if the core died, run the blocker.
      if (coreFailed || !this.core) {
        await this.stopCore();
        const b = await this.startCore("blocker");
        if (!b.ok) this.log("error", `Kill switch blocker failed: ${b.error}`);
      }
    } else {
      await this.stopCore(); // release the internet while we wait
    }
    if (op !== this.op) return;

    this.attempt++;
    const delay = BACKOFF[Math.min(this.attempt - 1, BACKOFF.length - 1)];
    this.log("warn", `VPN down (${detail || reason}). Reconnect attempt ${this.attempt} in ${delay / 1000}s.`);
    this.setState({
      status: "reconnecting",
      blocking: ks,
      error: reason,
      errorDetail: detail || undefined,
      phase: undefined,
      publicIp: undefined,
      reconnect: { attempt: this.attempt, max: ks ? 0 : MAX_RECONNECTS, nextAt: Date.now() + delay },
    });
    if (this.mode === "tunnel") this.startHealth(); // may detect recovery before the timer fires
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (op !== this.op) return;
      void (async () => {
        await this.stopCore();
        if (op !== this.op) return;
        await this.attemptReconnect(op);
      })();
    }, delay);
  }

  private async attemptReconnect(op: number) {
    this.log("info", `Reconnecting (attempt ${this.attempt})...`);
    this.setState({ phase: "connecting" });
    await this.bringUp(op, false);
  }

  private startHealth() {
    if (this.healthTimer) clearInterval(this.healthTimer);
    const op = this.op;
    this.healthTimer = setInterval(async () => {
      if (op !== this.op || !this.api || this.mode !== "tunnel" || this.busy) return;
      const ms = await this.api.delay(PROXY_TAG, this.settings.pingUrl, 6000);
      if (op !== this.op) return;
      if (ms >= 0) {
        this.healthFails = 0;
        if (this.state.status === "reconnecting") {
          const p = this.profile(this.desired);
          if (p) {
            if (this.retryTimer) clearTimeout(this.retryTimer);
            this.onUp(p, ms, false);
          }
        }
        return;
      }
      if (this.state.status !== "connected") return;
      if (++this.healthFails >= HEALTH_FAILS_BEFORE_DOWN) {
        if (this.healthTimer) clearInterval(this.healthTimer);
        this.healthTimer = null;
        await this.api?.closeAllConnections();
        await this.handleDown(op, "The connection was lost.", this.core?.lastError() ?? "", false, false);
      }
    }, HEALTH_INTERVAL);
  }

  private onCoreExit(proc: CoreProcess, code: number | null) {
    if (proc !== this.core) return; // stopped intentionally
    const detail = `sing-box exited (code ${code}): ${proc.lastError()}`;
    this.log("error", detail);
    this.core = null;
    this.api = null;
    this.mode = null;
    this.stopTraffic?.();
    this.stopTraffic = null;
    if (!this.desired) return;
    const op = ++this.op;
    this.clearTimers();
    void this.handleDown(op, "The VPN engine stopped unexpectedly.", detail, true, false);
  }

  // ---------------- public IP ----------------

  private async refreshPublicIp(p: Profile) {
    const op = this.op;
    const info = await fetchPublicIp();
    if (!info || op !== this.op || this.state.status !== "connected") return;
    this.setState({ publicIp: info });
    if (info.countryCode && p.country !== info.countryCode) {
      p.country = info.countryCode;
      this.store.profiles.save();
      this.emit("profileUpdated", p);
    }
  }

  // ---------------- traffic ----------------

  private sessionUp = 0;
  private sessionDown = 0;
  private sessionSeconds = 0;
  private peakUp = 0;
  private peakDown = 0;

  private resetSession() {
    this.sessionUp = this.sessionDown = this.sessionSeconds = this.peakUp = this.peakDown = 0;
    this.history = [];
    this.snapshot = null;
  }

  private endSession() {
    this.stopTraffic?.();
    this.stopTraffic = null;
    this.store.stats.save();
  }

  private startTrafficStream(api: ClashApi) {
    this.stopTraffic?.();
    const stop = api.streamTraffic(
      (up, down) => this.onSample(up, down),
      () => {
        if (this.stopTraffic === stop) this.stopTraffic = null;
      },
    );
    this.stopTraffic = stop;
  }

  private onSample(up: number, down: number) {
    const connected = this.state.status === "connected";
    const sample: TrafficSample = { t: Date.now(), up: connected ? up : 0, down: connected ? down : 0 };
    this.history.push(sample);
    if (this.history.length > HISTORY) this.history.shift();
    if (connected) {
      this.sessionUp += up;
      this.sessionDown += down;
      this.sessionSeconds += 1;
      this.peakUp = Math.max(this.peakUp, up);
      this.peakDown = Math.max(this.peakDown, down);
      const key = todayKey();
      const day = (this.store.stats.data[key] ??= { date: key, seconds: 0, up: 0, down: 0 });
      day.seconds += 1;
      day.up += up;
      day.down += down;
      if (this.sessionSeconds % 30 === 0) this.store.stats.save();
    }
    const secs = Math.max(1, this.sessionSeconds);
    this.snapshot = {
      current: sample,
      sessionUp: this.sessionUp,
      sessionDown: this.sessionDown,
      sessionSeconds: this.sessionSeconds,
      avgUp: this.sessionUp / secs,
      avgDown: this.sessionDown / secs,
      peakUp: this.peakUp,
      peakDown: this.peakDown,
    };
    this.emit("traffic", this.snapshot);
  }

  // ---------------- speed test ----------------

  async speedTest(): Promise<SpeedTestResult> {
    const latencies: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const r = await fetch("https://speed.cloudflare.com/__down?bytes=0", { cache: "no-store", signal: AbortSignal.timeout(8000) });
      await r.arrayBuffer();
      latencies.push(performance.now() - t0);
    }
    const bytes = 25_000_000;
    const t0 = performance.now();
    const res = await fetch(`https://speed.cloudflare.com/__down?bytes=${bytes}`, { cache: "no-store", signal: AbortSignal.timeout(60000) });
    if (!res.ok || !res.body) throw new Error(`Speed test failed (${res.status})`);
    let received = 0;
    const reader = res.body.getReader();
    // Stop after 12 s on slow links and compute from what we got.
    const deadline = t0 + 12000;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (performance.now() > deadline) {
        await reader.cancel();
        break;
      }
    }
    const secs = (performance.now() - t0) / 1000;
    return { downloadMbps: (received * 8) / secs / 1e6, latencyMs: Math.round(Math.min(...latencies)), at: Date.now() };
  }
}

export async function fetchPublicIp(): Promise<PublicIpInfo | null> {
  try {
    const r = await fetch("https://ipwho.is/", { signal: AbortSignal.timeout(7000) });
    const j = (await r.json()) as { success?: boolean; ip: string; country?: string; country_code?: string; city?: string; connection?: { isp?: string } };
    if (j.success !== false && j.ip) {
      return { ip: j.ip, country: j.country, countryCode: j.country_code, city: j.city, isp: j.connection?.isp };
    }
  } catch {
    /* try fallback */
  }
  try {
    const r = await fetch("https://ipinfo.io/json", { signal: AbortSignal.timeout(7000) });
    const j = (await r.json()) as { ip: string; country?: string; city?: string; org?: string };
    return { ip: j.ip, countryCode: j.country, city: j.city, isp: j.org };
  } catch {
    return null;
  }
}
