"use client";

import type {
  DailyStat,
  ImportResult,
  LogLine,
  Profile,
  Settings,
  TrafficSample,
  TrafficSnapshot,
  VpnApi,
  VpnState,
} from "@shared/types";

declare global {
  interface Window {
    vpn?: VpnApi;
  }
}

/**
 * Browser-only mock so the UI can be developed / previewed with `next dev` outside Electron.
 * In the Electron app the preload script provides the real `window.vpn`.
 */
function createMockApi(): VpnApi {
  type L<T> = Set<(v: T) => void>;
  const listeners = {
    state: new Set() as L<VpnState>,
    traffic: new Set() as L<TrafficSnapshot>,
    profiles: new Set() as L<Profile[]>,
    ping: new Set() as L<{ done: number; total: number; running: boolean }>,
    log: new Set() as L<LogLine>,
  };
  const emit = <T,>(set: L<T>, v: T) => set.forEach((cb) => cb(v));
  const mk = (name: string, protocol: Profile["protocol"], detail: string, country: string, ping?: number): Profile => ({
    id: Math.random().toString(36).slice(2),
    name,
    protocol,
    detail,
    host: `${country.toLowerCase()}.example.net`,
    port: 443,
    kind: protocol === "wireguard" || protocol === "openvpn" ? "endpoint" : "outbound",
    config: {},
    country,
    ping,
    createdAt: Date.now(),
  });
  let profiles: Profile[] = [
    mk("Germany · Frankfurt", "vless", "VLESS · TCP · Reality", "DE", 142),
    mk("Netherlands WS", "vmess", "VMess · WS · TLS", "NL", 188),
    mk("Finland gRPC", "vless", "VLESS · gRPC · TLS", "FI", 233),
    mk("Turkey SSH", "ssh", "SSH · Password", "TR", 96),
    mk("Windscribe Frankfurt", "wireguard", "WireGuard", "DE", 121),
    mk("Windscribe London", "openvpn", "OpenVPN · UDP", "GB", 310),
    mk("US Trojan", "trojan", "Trojan · WS · TLS", "US", -1),
    mk("Japan Hysteria", "hysteria2", "Hysteria2", "JP"),
  ];
  let settings: Settings = {
    killSwitch: { enabled: true, exceptions: ["ir", "bank.example.com"] },
    remoteDns: "1.1.1.1",
    tunStack: "mixed",
    mtu: 9000,
    ipv6: false,
    pingUrl: "https://www.youtube.com/generate_204",
    pingTimeout: 5000,
    connectOnLaunch: false,
    launchAtStartup: false,
    systemNotifications: true,
    autoReconnect: true,
    theme: "light",
    sortBy: "ping",
  };
  let state: VpnState = { status: "disconnected", blocking: false };
  const history: TrafficSample[] = [];
  let snapshot: TrafficSnapshot | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let tot = { up: 0, down: 0, secs: 0, pu: 0, pd: 0 };
  const setState = (p: Partial<VpnState>) => {
    state = { ...state, ...p };
    emit(listeners.state, state);
  };
  const tick = () => {
    const connected = state.status === "connected";
    const down = connected ? Math.max(0, 900_000 + Math.sin(Date.now() / 3000) * 700_000 + Math.random() * 600_000) : 0;
    const up = connected ? down * (0.08 + Math.random() * 0.1) : 0;
    const s = { t: Date.now(), up, down };
    history.push(s);
    if (history.length > 120) history.shift();
    if (connected) {
      tot = { up: tot.up + up, down: tot.down + down, secs: tot.secs + 1, pu: Math.max(tot.pu, up), pd: Math.max(tot.pd, down) };
    }
    snapshot = {
      current: s,
      sessionUp: tot.up,
      sessionDown: tot.down,
      sessionSeconds: tot.secs,
      avgUp: tot.up / Math.max(1, tot.secs),
      avgDown: tot.down / Math.max(1, tot.secs),
      peakDown: tot.pd,
      peakUp: tot.pu,
    };
    emit(listeners.traffic, snapshot);
  };
  const noResult: ImportResult = { added: [], errors: [] };
  if (typeof window !== "undefined") {
    (window as unknown as { __mockDrop: () => void }).__mockDrop = () =>
      setState({
        status: "reconnecting",
        blocking: settings.killSwitch.enabled,
        error: "The connection was lost.",
        reconnect: { attempt: 2, max: settings.killSwitch.enabled ? 0 : 5, nextAt: Date.now() + 8000 },
      });
  }
  const sub = <T,>(set: L<T>) => (cb: (v: T) => void) => {
    set.add(cb);
    return () => set.delete(cb);
  };
  return {
    getSystemInfo: async () => ({ isAdmin: true, core: { found: true, path: "mock", version: "1.14.4" }, platform: "web", appVersion: "dev" }),
    listProfiles: async () => profiles,
    importText: async () => noResult,
    importFiles: async () => noResult,
    importClipboard: async () => noResult,
    addSsh: async (f) => {
      const p = mk(f.name || f.host, "ssh", "SSH · Password", "US");
      profiles = [...profiles, p];
      emit(listeners.profiles, profiles);
      return { added: [p], errors: [] };
    },
    updateProfile: async (id, patch) => {
      profiles = profiles.map((p) => (p.id === id ? { ...p, ...patch } : p));
      emit(listeners.profiles, profiles);
      return profiles.find((p) => p.id === id)!;
    },
    removeProfiles: async (ids) => {
      profiles = profiles.filter((p) => !ids.includes(p.id));
      emit(listeners.profiles, profiles);
    },
    pingAll: async () => {
      let done = 0;
      emit(listeners.ping, { done, total: profiles.length, running: true });
      for (const p of profiles) {
        await new Promise((r) => setTimeout(r, 180));
        p.ping = Math.random() < 0.15 ? -1 : Math.round(60 + Math.random() * 500);
        p.pingAt = Date.now();
        done++;
        profiles = [...profiles];
        emit(listeners.profiles, profiles);
        emit(listeners.ping, { done, total: profiles.length, running: done < profiles.length });
      }
    },
    exportLink: async () => "vless://example",
    listSubscriptions: async () => [],
    addSubscription: async () => noResult,
    refreshSubscription: async () => noResult,
    removeSubscription: async () => {},
    connect: async (id) => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const p = profiles.find((x) => x.id === id);
      setState({ status: "connecting", phase: "starting", profileId: id, error: undefined, errorDetail: undefined, reconnect: undefined });
      await wait(900);
      setState({ phase: "connecting" });
      await wait(1100);
      setState({ phase: "verifying" });
      await wait(900);
      if (p && p.ping === -1) {
        setState({
          status: "disconnected",
          phase: undefined,
          error: "The server did not respond in time.",
          errorDetail: "dial tcp 203.0.113.7:443: i/o timeout",
        });
        return;
      }
      tot = { up: 0, down: 0, secs: 0, pu: 0, pd: 0 };
      setState({ status: "connected", phase: undefined, since: Date.now(), publicIp: { ip: "185.12.34.56", countryCode: p?.country, city: "Frankfurt" } });
      timer ??= setInterval(tick, 1000);
    },
    reconnectNow: async () => {
      setState({ phase: "connecting" });
      await new Promise((r) => setTimeout(r, 1500));
      setState({ status: "connected", phase: undefined, reconnect: undefined, error: undefined, blocking: false });
    },
    relaunchAsAdmin: async () => {},
    disconnect: async () => {
      setState({ status: "disconnected", since: undefined, publicIp: undefined });
    },
    getState: async () => state,
    getTraffic: async () => ({ snapshot, history }),
    runSpeedTest: async () => {
      await new Promise((r) => setTimeout(r, 2500));
      return { downloadMbps: 48.3, latencyMs: 132, at: Date.now() };
    },
    getSettings: async () => settings,
    setSettings: async (patch) => {
      settings = { ...settings, ...patch, killSwitch: { ...settings.killSwitch, ...(patch.killSwitch ?? {}) } };
      return settings;
    },
    getDailyStats: async (days) => {
      const out: DailyStat[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        out.push({ date: d.toISOString().slice(0, 10), seconds: Math.round(Math.random() * 30000), up: Math.random() * 3e8, down: Math.random() * 3e9 });
      }
      return out;
    },
    getLogs: async () => [{ t: Date.now(), level: "info", msg: "Mock backend (browser preview)" }],
    openExternal: async (url) => {
      window.open(url, "_blank");
    },
    onState: sub(listeners.state),
    onTraffic: sub(listeners.traffic),
    onProfiles: sub(listeners.profiles),
    onPingProgress: sub(listeners.ping),
    onLog: sub(listeners.log),
  };
}

let cached: VpnApi | null = null;
export function api(): VpnApi {
  if (cached) return cached;
  cached = typeof window !== "undefined" && window.vpn ? window.vpn : createMockApi();
  return cached;
}

export const isElectron = () => typeof window !== "undefined" && !!window.vpn;
