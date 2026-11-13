// Real-delay testing of many profiles at once via a temporary sing-box instance.

import { existsSync } from "node:fs";
import { connect } from "node:net";
import type { Profile, Settings } from "../shared/types";
import { ClashApi, CoreProcess, corePath, freePort, pingerPath, randomSecret } from "./core";
import { buildPingerConfig } from "./singbox-config";

const CONCURRENCY = 16;

function tcpPing(host: string, port: number, timeout: number): Promise<number> {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = connect({ host, port, timeout });
    const done = (v: number) => {
      sock.destroy();
      resolve(v);
    };
    sock.once("connect", () => done(Date.now() - start));
    sock.once("timeout", () => done(-1));
    sock.once("error", () => done(-1));
  });
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

/** Starts the pinger, dropping profiles that the core refuses (reported by index in its error). */
async function startPinger(
  profiles: Profile[],
  log: (l: string) => void,
): Promise<{ proc: CoreProcess; api: ClashApi; usable: Profile[]; rejected: Profile[] } | null> {
  let usable = [...profiles];
  const rejected: Profile[] = [];
  for (let attempt = 0; attempt < 8 && usable.length; attempt++) {
    const port = await freePort();
    const secret = randomSecret();
    const proc = new CoreProcess({
      exe: pingerPath(),
      name: "pinger",
      config: buildPingerConfig(usable, { clashPort: port, clashSecret: secret }),
      onLog: (l) => log(`[pinger] ${l}`),
    });
    proc.start();
    const api = new ClashApi(port, secret);
    if (await api.ready(6000)) return { proc, api, usable, rejected };
    const err = proc.lastError();
    await proc.stop();
    // Errors name the failing node either by tag ("endpoint/openvpn-client[<id>]")
    // or by index ("outbounds[3]"). Tags are profile ids.
    let bad: Profile | undefined;
    const byTag = err.match(/(?:outbound|endpoint)\/[\w-]+\[([^\]]+)\]/i);
    if (byTag) bad = usable.find((p) => p.id === byTag[1]);
    if (!bad) {
      const byIdx = err.match(/(outbound|endpoint)s?\[(\d+)\]/i);
      if (byIdx) {
        const isEndpoint = byIdx[1].toLowerCase() === "endpoint";
        bad = usable.filter((p) => (p.kind === "endpoint") === isEndpoint)[Number(byIdx[2])];
      }
    }
    if (!bad) {
      log(`[pinger] failed to start: ${err}`);
      return null;
    }
    log(`[pinger] skipping "${bad.name}": ${err}`);
    rejected.push(bad);
    usable = usable.filter((p) => p !== bad);
  }
  return null;
}

export async function pingProfiles(
  profiles: Profile[],
  settings: Settings,
  onResult: (id: string, ms: number) => void,
  onProgress: (done: number, total: number) => void,
  log: (l: string) => void,
): Promise<void> {
  const total = profiles.length;
  let done = 0;
  const report = (id: string, ms: number) => {
    onResult(id, ms);
    onProgress(++done, total);
  };
  onProgress(0, total);
  if (!total) return;

  if (!existsSync(corePath())) {
    // No core available: plain TCP connect time.
    await pool(profiles, CONCURRENCY, async (p) => report(p.id, await tcpPing(p.host, p.port, settings.pingTimeout)));
    return;
  }

  const started = await startPinger(profiles, log);
  if (!started) {
    await pool(profiles, CONCURRENCY, async (p) => report(p.id, await tcpPing(p.host, p.port, settings.pingTimeout)));
    return;
  }
  const { proc, api, usable, rejected } = started;
  for (const r of rejected) report(r.id, -1);
  try {
    await pool(usable, CONCURRENCY, async (p) => {
      let ms = await api.delay(p.id, settings.pingUrl, settings.pingTimeout);
      // First request includes handshake warm-up; retry once on failure.
      if (ms < 0) ms = await api.delay(p.id, settings.pingUrl, settings.pingTimeout);
      report(p.id, ms);
    });
  } finally {
    await proc.stop();
  }
}
