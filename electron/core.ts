// sing-box process management + Clash API client.

import { app } from "electron";
import { ChildProcess, execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";
import type { CoreInfo } from "../shared/types";
import { PINGER_EXE } from "./singbox-config";

export function binDir(): string {
  return app.isPackaged ? join(process.resourcesPath, "bin") : join(app.getAppPath(), "resources", "bin");
}

export function corePath(): string {
  return join(binDir(), "sing-box.exe");
}

export function workDir(): string {
  const d = join(app.getPath("userData"), "core");
  mkdirSync(d, { recursive: true });
  return d;
}

/**
 * The pinger runs as a copy of sing-box with a different file name so the tunnel
 * can route its traffic directly (process_name rule) – otherwise ping results
 * would be measured through the active VPN.
 */
export function pingerPath(): string {
  const src = corePath();
  const dst = join(workDir(), PINGER_EXE);
  try {
    if (!existsSync(dst) || statSync(dst).size !== statSync(src).size) copyFileSync(src, dst);
    return dst;
  } catch {
    return src;
  }
}

export function getCoreInfo(): Promise<CoreInfo> {
  const path = corePath();
  if (!existsSync(path)) return Promise.resolve({ found: false, path });
  return new Promise((resolve) => {
    execFile(path, ["version"], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      const m = stdout?.match(/version\s+(\S+)/);
      resolve({ found: !err, path, version: m?.[1] });
    });
  });
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export function randomSecret() {
  return randomBytes(12).toString("hex");
}

export class ClashApi {
  constructor(
    readonly port: number,
    readonly secret: string,
  ) {}

  private request<T>(path: string, timeoutMs = 10000): Promise<{ status: number; body: T }> {
    return new Promise((resolve, reject) => {
      const req = http.get(
        { host: "127.0.0.1", port: this.port, path, headers: { Authorization: `Bearer ${this.secret}` }, timeout: timeoutMs },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : ({} as T) });
            } catch {
              resolve({ status: res.statusCode ?? 0, body: data as unknown as T });
            }
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
    });
  }

  async ready(timeoutMs = 8000): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      try {
        const r = await this.request("/version", 1000);
        if (r.status === 200) return true;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  }

  /** Real URL delay through `tag`. Returns ms, or -1 on failure. */
  async delay(tag: string, url: string, timeout: number): Promise<number> {
    try {
      const r = await this.request<{ delay?: number }>(
        `/proxies/${encodeURIComponent(tag)}/delay?url=${encodeURIComponent(url)}&timeout=${timeout}`,
        timeout + 3000,
      );
      return r.status === 200 && typeof r.body.delay === "number" && r.body.delay > 0 ? r.body.delay : -1;
    } catch {
      return -1;
    }
  }

  async closeAllConnections() {
    await new Promise<void>((resolve) => {
      const req = http.request(
        { host: "127.0.0.1", port: this.port, path: "/connections", method: "DELETE", headers: { Authorization: `Bearer ${this.secret}` } },
        (res) => {
          res.resume();
          res.on("end", resolve);
        },
      );
      req.on("error", () => resolve());
      req.end();
    });
  }

  /** Streams {up, down} bytes/s once a second. Returns a stop function. */
  streamTraffic(onSample: (up: number, down: number) => void, onEnd: () => void): () => void {
    let stopped = false;
    const req = http.get(
      { host: "127.0.0.1", port: this.port, path: "/traffic", headers: { Authorization: `Bearer ${this.secret}` } },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buf += chunk;
          let i: number;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line) continue;
            try {
              const j = JSON.parse(line) as { up: number; down: number };
              onSample(j.up ?? 0, j.down ?? 0);
            } catch {
              /* ignore */
            }
          }
        });
        res.on("end", () => !stopped && onEnd());
      },
    );
    req.on("error", () => !stopped && onEnd());
    return () => {
      stopped = true;
      req.destroy();
    };
  }
}

export interface CoreProcessOptions {
  exe: string;
  config: unknown;
  name: string;
  onLog?: (line: string) => void;
  onExit?: (code: number | null) => void;
}

/** A running sing-box instance. */
export class CoreProcess {
  private proc: ChildProcess | null = null;
  private exited = false;
  private stderrTail: string[] = [];

  constructor(private opts: CoreProcessOptions) {}

  start(): void {
    const cfgPath = join(workDir(), `${this.opts.name}.json`);
    writeFileSync(cfgPath, JSON.stringify(this.opts.config, null, 1));
    this.proc = spawn(this.opts.exe, ["run", "-c", cfgPath, "-D", workDir(), "--disable-color"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const onData = (d: Buffer) => {
      for (const line of d.toString("utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        this.stderrTail.push(line);
        if (this.stderrTail.length > 30) this.stderrTail.shift();
        this.opts.onLog?.(line);
      }
    };
    this.proc.stdout?.on("data", onData);
    this.proc.stderr?.on("data", onData);
    this.proc.on("exit", (code) => {
      this.exited = true;
      this.opts.onExit?.(code);
    });
    this.proc.on("error", (e) => {
      this.stderrTail.push(String(e));
      this.exited = true;
      this.opts.onExit?.(-1);
    });
  }

  get running() {
    return !!this.proc && !this.exited;
  }

  /** Last meaningful error line from the core's output. */
  lastError(): string {
    const errs = this.stderrTail.filter((l) => /FATAL|ERROR|error/i.test(l));
    const line = errs[errs.length - 1] ?? this.stderrTail[this.stderrTail.length - 1] ?? "";
    return line.replace(/^.*?(FATAL|ERROR)\[\d+\]\s*/, "").trim();
  }

  async stop(): Promise<void> {
    if (!this.proc || this.exited) return;
    const p = this.proc;
    this.opts.onExit = undefined;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try {
          p.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        resolve();
      }, 3000);
      p.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
      // On Windows there are no signals: kill() terminates the process, and sing-box's TUN
      // routes are tied to the adapter, so they disappear with it.
      p.kill();
    });
  }
}
