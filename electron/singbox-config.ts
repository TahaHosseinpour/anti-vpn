// Builds sing-box JSON configurations.

import { isIP } from "node:net";
import type { Profile, Settings } from "../shared/types";

type Json = Record<string, unknown>;

export const PROXY_TAG = "proxy";
export const PINGER_EXE = "antivpn-pinger.exe";
export const TUN_NAME = "AntiVPN";

export interface ParsedExceptions {
  domains: string[];
  cidrs: string[];
}

/** Turns the user's exception list into sing-box matchers. */
export function parseExceptions(list: string[]): ParsedExceptions {
  const domains = new Set<string>();
  const cidrs = new Set<string>();
  for (let raw of list) {
    raw = raw.trim().toLowerCase();
    if (!raw) continue;
    raw = raw.replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, (m) => (/^\/\d+$/.test(m) ? m : ""));
    raw = raw.replace(/^\*\./, "").replace(/^\./, "");
    const [addr, prefix] = raw.split("/");
    const v = isIP(addr);
    if (v) {
      cidrs.add(prefix ? `${addr}/${prefix}` : `${addr}/${v === 4 ? 32 : 128}`);
    } else if (/^[a-z0-9.-]+$/.test(raw)) {
      domains.add(raw.replace(/:\d+$/, ""));
    }
  }
  return { domains: [...domains], cidrs: [...cidrs] };
}

function exceptionRule(ex: ParsedExceptions, extra: Json): Json[] {
  const rules: Json[] = [];
  if (ex.domains.length) rules.push({ domain_suffix: ex.domains, ...extra });
  if (ex.cidrs.length) rules.push({ ip_cidr: ex.cidrs, ...extra });
  return rules;
}

function tunInbound(s: Settings): Json {
  return {
    type: "tun",
    tag: "tun-in",
    interface_name: TUN_NAME,
    address: s.ipv6 ? ["172.19.0.1/30", "fdfe:dcba:9876::1/126"] : ["172.19.0.1/30"],
    mtu: s.mtu || 9000,
    auto_route: true,
    strict_route: true,
    stack: s.tunStack,
  };
}

function profileNode(p: Profile, tag: string): Json {
  return { ...p.config, tag };
}

function remoteDnsServer(s: Settings): Json {
  const v = s.remoteDns.trim() || "1.1.1.1";
  if (v.startsWith("https://")) {
    const u = new URL(v);
    return { type: "https", tag: "remote", server: u.hostname, path: u.pathname || "/dns-query", detour: PROXY_TAG };
  }
  if (v.startsWith("tls://")) return { type: "tls", tag: "remote", server: v.slice(6), detour: PROXY_TAG };
  return { type: "tcp", tag: "remote", server: v, detour: PROXY_TAG };
}

export interface BuildOptions {
  clashPort: number;
  clashSecret: string;
  logLevel?: string;
}

/** Full tunnel: everything goes through the profile, exceptions + LAN go direct. */
export function buildTunnelConfig(p: Profile, s: Settings, o: BuildOptions): Json {
  const ex = parseExceptions(s.killSwitch.exceptions);
  const strategy = s.ipv6 ? "prefer_ipv4" : "ipv4_only";
  const node = profileNode(p, PROXY_TAG);
  return {
    log: { level: o.logLevel ?? "warn", timestamp: false },
    dns: {
      servers: [remoteDnsServer(s), { type: "local", tag: "local" }],
      rules: [...(ex.domains.length ? [{ domain_suffix: ex.domains, server: "local" }] : [])],
      final: "remote",
      strategy,
    },
    inbounds: [tunInbound(s)],
    outbounds: [...(p.kind === "outbound" ? [node] : []), { type: "direct", tag: "direct" }],
    endpoints: p.kind === "endpoint" ? [node] : [],
    route: {
      rules: [
        { action: "sniff" },
        { protocol: "dns", action: "hijack-dns" },
        { process_name: [PINGER_EXE], outbound: "direct" },
        { ip_is_private: true, outbound: "direct" },
        ...exceptionRule(ex, { outbound: "direct" }),
      ],
      final: PROXY_TAG,
      auto_detect_interface: true,
      default_domain_resolver: { server: "local", strategy },
    },
    experimental: {
      clash_api: { external_controller: `127.0.0.1:${o.clashPort}`, secret: o.clashSecret },
    },
  };
}

/**
 * Kill-switch "blocker": used when the VPN is supposed to be up but the core could not start.
 * Grabs all traffic with TUN and rejects everything except exceptions and LAN.
 */
export function buildBlockerConfig(s: Settings, o: BuildOptions): Json {
  const ex = parseExceptions(s.killSwitch.exceptions);
  return {
    log: { level: o.logLevel ?? "warn", timestamp: false },
    dns: {
      servers: [{ type: "local", tag: "local" }],
      rules: [
        ...(ex.domains.length
          ? [{ domain_suffix: ex.domains, invert: true, action: "predefined", rcode: "REFUSED" }]
          : [{ domain_regex: [".*"], action: "predefined", rcode: "REFUSED" }]),
      ],
      final: "local",
    },
    inbounds: [tunInbound(s)],
    outbounds: [{ type: "direct", tag: "direct" }],
    route: {
      rules: [
        { action: "sniff" },
        { protocol: "dns", action: "hijack-dns" },
        { process_name: [PINGER_EXE], outbound: "direct" },
        { ip_is_private: true, outbound: "direct" },
        ...exceptionRule(ex, { outbound: "direct" }),
        { action: "reject" },
      ],
      final: "direct",
      auto_detect_interface: true,
      default_domain_resolver: "local",
    },
    experimental: {
      clash_api: { external_controller: `127.0.0.1:${o.clashPort}`, secret: o.clashSecret },
    },
  };
}

/** Pinger: no inbounds, one outbound/endpoint per profile, delay-tested through the Clash API. */
export function buildPingerConfig(profiles: Profile[], o: BuildOptions): Json {
  const outbounds: Json[] = [];
  const endpoints: Json[] = [];
  for (const p of profiles) {
    const node = profileNode(p, p.id);
    // Endpoints in the pinger must not try to create system interfaces.
    if (p.kind === "endpoint") endpoints.push({ ...node, system: false });
    else outbounds.push(node);
  }
  outbounds.push({ type: "direct", tag: "direct" });
  return {
    log: { level: o.logLevel ?? "error", timestamp: false },
    dns: { servers: [{ type: "local", tag: "local" }] },
    outbounds,
    endpoints,
    route: { final: "direct", default_domain_resolver: "local" },
    experimental: {
      clash_api: { external_controller: `127.0.0.1:${o.clashPort}`, secret: o.clashSecret },
    },
  };
}
