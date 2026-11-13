// Converts user input (share links, WireGuard .conf, OpenVPN .ovpn, sing-box JSON,
// subscription bodies) into sing-box outbound / endpoint options.

import type { ImportOptions, Profile, Protocol, SshForm } from "../shared/types";
import { guessCountry } from "../shared/countries";

export type ParsedProfile = Omit<Profile, "id" | "createdAt">;

export class ParseError extends Error {}

type Json = Record<string, unknown>;

// ---------- helpers ----------

function b64decode(input: string): string {
  let s = input.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
}

function looksBase64(s: string): boolean {
  const t = s.trim().replace(/\s+/g, "");
  return t.length > 8 && /^[A-Za-z0-9+/_=-]+$/.test(t);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function splitList(v: string | null | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function compact<T extends Json>(o: T): T {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) delete o[k];
  }
  return o;
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function finish(p: Omit<ParsedProfile, "country"> & { country?: string }): ParsedProfile {
  const name = p.name?.trim() || `${p.host}:${p.port}`;
  return { ...p, name, country: p.country ?? guessCountry(name) };
}

/** Parses a generic `scheme://userinfo@host:port?query#name` URL. */
function parseUrl(link: string) {
  // URL() treats unknown schemes fine, but we normalise to http to get host/port parsing.
  const m = link.match(/^([a-z0-9+.-]+):\/\/(.*)$/i);
  if (!m) throw new ParseError("Not a URL");
  const scheme = m[1].toLowerCase();
  let rest = m[2];
  let name = "";
  const hashIdx = rest.indexOf("#");
  if (hashIdx >= 0) {
    name = safeDecode(rest.slice(hashIdx + 1));
    rest = rest.slice(0, hashIdx);
  }
  const u = new URL("http://" + rest);
  return {
    scheme,
    user: safeDecode(u.username),
    pass: safeDecode(u.password),
    host: stripBrackets(u.hostname),
    port: u.port ? Number(u.port) : 0,
    q: u.searchParams,
    name,
    path: u.pathname,
  };
}

// ---------- transport & TLS (shared by vmess/vless/trojan) ----------

interface StreamParams {
  network: string; // tcp, ws, grpc, http, h2, httpupgrade, quic, xhttp, kcp...
  security: string; // none, tls, reality
  host?: string;
  path?: string;
  headerType?: string;
  serviceName?: string;
  sni?: string;
  alpn?: string;
  fp?: string;
  pbk?: string;
  sid?: string;
  insecure?: boolean;
}

function buildTransport(sp: StreamParams): { transport?: Json; label: string } {
  const net = (sp.network || "tcp").toLowerCase();
  switch (net) {
    case "tcp":
    case "raw":
    case "":
      if (sp.headerType === "http") {
        return {
          transport: compact({
            type: "http",
            host: splitList(sp.host),
            path: sp.path || "/",
            method: "GET",
          }),
          label: "TCP·HTTP",
        };
      }
      return { label: "TCP" };
    case "ws": {
      let path = sp.path || "/";
      const t: Json = { type: "ws" };
      // Xray-style early data: /path?ed=2048
      const edMatch = path.match(/[?&]ed=(\d+)/);
      if (edMatch) {
        t.max_early_data = Number(edMatch[1]);
        t.early_data_header_name = "Sec-WebSocket-Protocol";
        path = path.replace(/[?&]ed=\d+/, "").replace(/\?$/, "") || "/";
      }
      t.path = path;
      if (sp.host) t.headers = { Host: sp.host };
      return { transport: t, label: "WS" };
    }
    case "grpc":
      return { transport: compact({ type: "grpc", service_name: sp.serviceName || sp.path || "" }), label: "gRPC" };
    case "http":
    case "h2":
      return {
        transport: compact({ type: "http", host: splitList(sp.host), path: sp.path || "/" }),
        label: "H2",
      };
    case "httpupgrade":
      return {
        transport: compact({ type: "httpupgrade", host: sp.host, path: sp.path || "/" }),
        label: "HTTPUpgrade",
      };
    case "quic":
      return { transport: { type: "quic" }, label: "QUIC" };
    default:
      throw new ParseError(`Transport "${net}" is not supported by the sing-box engine`);
  }
}

function buildTls(sp: StreamParams, fallbackSni: string): { tls?: Json; label: string } {
  const sec = (sp.security || "none").toLowerCase();
  if (sec === "none" || sec === "") return { label: "" };
  const tls: Json = {
    enabled: true,
    server_name: sp.sni || sp.host?.split(",")[0] || fallbackSni,
    insecure: sp.insecure || undefined,
    alpn: splitList(sp.alpn),
  };
  if (sp.fp) tls.utls = { enabled: true, fingerprint: sp.fp };
  if (sec === "reality") {
    if (!sp.pbk) throw new ParseError("REALITY config is missing its public key (pbk)");
    tls.reality = compact({ enabled: true, public_key: sp.pbk, short_id: sp.sid ?? "" });
    if (!tls.utls) tls.utls = { enabled: true, fingerprint: "chrome" };
    return { tls: compact(tls), label: "Reality" };
  }
  if (sec !== "tls" && sec !== "xtls") throw new ParseError(`Security "${sec}" is not supported`);
  return { tls: compact(tls), label: "TLS" };
}

function streamFromQuery(q: URLSearchParams, defaultSecurity = "none"): StreamParams {
  return {
    network: q.get("type") || "tcp",
    security: q.get("security") || defaultSecurity,
    host: q.get("host") || undefined,
    path: q.get("path") ? safeDecode(q.get("path")!) : undefined,
    headerType: q.get("headerType") || undefined,
    serviceName: q.get("serviceName") || undefined,
    sni: q.get("sni") || q.get("peer") || undefined,
    alpn: q.get("alpn") ? safeDecode(q.get("alpn")!) : undefined,
    fp: q.get("fp") || undefined,
    pbk: q.get("pbk") || undefined,
    sid: q.get("sid") || undefined,
    insecure: ["1", "true"].includes(q.get("allowInsecure") ?? q.get("insecure") ?? ""),
  };
}

function label(...parts: string[]) {
  return parts.filter(Boolean).join(" · ");
}

// ---------- protocol parsers ----------

function parseVmess(link: string): ParsedProfile {
  const body = link.slice("vmess://".length).split("#")[0];
  let j: Json;
  try {
    j = JSON.parse(b64decode(body));
  } catch {
    // Some clients use the vless-like URL form for vmess.
    const u = parseUrl(link);
    const sp = streamFromQuery(u.q);
    const tr = buildTransport(sp);
    const tl = buildTls(sp, u.host);
    return finish({
      name: u.name,
      protocol: "vmess",
      detail: label("VMess", tr.label, tl.label),
      host: u.host,
      port: u.port,
      kind: "outbound",
      raw: link,
      config: compact({
        type: "vmess",
        server: u.host,
        server_port: u.port,
        uuid: u.user,
        security: u.q.get("encryption") || "auto",
        alter_id: 0,
        transport: tr.transport,
        tls: tl.tls,
      }),
    });
  }
  const host = String(j.add ?? "");
  const port = Number(j.port);
  if (!host || !port) throw new ParseError("VMess link has no address/port");
  const sp: StreamParams = {
    network: String(j.net || "tcp"),
    security: String(j.tls || "none"),
    host: j.host ? String(j.host) : undefined,
    path: j.path ? String(j.path) : undefined,
    headerType: j.type ? String(j.type) : undefined,
    serviceName: j.net === "grpc" ? String(j.path || "") : undefined,
    sni: j.sni ? String(j.sni) : undefined,
    alpn: j.alpn ? String(j.alpn) : undefined,
    fp: j.fp ? String(j.fp) : undefined,
    insecure: j.allowInsecure === true || j.allowInsecure === "1",
  };
  const tr = buildTransport(sp);
  const tl = buildTls(sp, host);
  return finish({
    name: String(j.ps ?? ""),
    protocol: "vmess",
    detail: label("VMess", tr.label, tl.label),
    host,
    port,
    kind: "outbound",
    raw: link,
    config: compact({
      type: "vmess",
      server: host,
      server_port: port,
      uuid: String(j.id),
      security: String(j.scy || "auto"),
      alter_id: Number(j.aid || 0),
      transport: tr.transport,
      tls: tl.tls,
    }),
  });
}

function parseVless(link: string): ParsedProfile {
  const u = parseUrl(link);
  if (!u.user) throw new ParseError("VLESS link has no UUID");
  const sp = streamFromQuery(u.q);
  const tr = buildTransport(sp);
  const tl = buildTls(sp, u.host);
  const flow = u.q.get("flow") || undefined;
  return finish({
    name: u.name,
    protocol: "vless",
    detail: label("VLESS", tr.label, tl.label),
    host: u.host,
    port: u.port || 443,
    kind: "outbound",
    raw: link,
    config: compact({
      type: "vless",
      server: u.host,
      server_port: u.port || 443,
      uuid: u.user,
      flow: flow && flow !== "none" ? flow.replace(/-udp443$/, "") : undefined,
      packet_encoding: "xudp",
      transport: tr.transport,
      tls: tl.tls,
    }),
  });
}

function parseTrojan(link: string): ParsedProfile {
  const u = parseUrl(link);
  const sp = streamFromQuery(u.q, "tls");
  const tr = buildTransport(sp);
  const tl = buildTls(sp, u.host);
  return finish({
    name: u.name,
    protocol: "trojan",
    detail: label("Trojan", tr.label, tl.label),
    host: u.host,
    port: u.port || 443,
    kind: "outbound",
    raw: link,
    config: compact({
      type: "trojan",
      server: u.host,
      server_port: u.port || 443,
      password: u.user,
      transport: tr.transport,
      tls: tl.tls,
    }),
  });
}

function parseShadowsocks(link: string): ParsedProfile {
  let body = link.slice("ss://".length);
  let name = "";
  const h = body.indexOf("#");
  if (h >= 0) {
    name = safeDecode(body.slice(h + 1));
    body = body.slice(0, h);
  }
  let query = "";
  const qi = body.indexOf("?");
  if (qi >= 0) {
    query = body.slice(qi + 1);
    body = body.slice(0, qi);
  }
  body = body.replace(/\/$/, "");
  let method: string, password: string, host: string, port: number;
  if (!body.includes("@")) {
    // legacy: base64(method:password@host:port)
    const dec = b64decode(body);
    const m = dec.match(/^(.+?):(.*)@(.+):(\d+)$/);
    if (!m) throw new ParseError("Invalid Shadowsocks link");
    [, method, password, host] = m;
    port = Number(m[4]);
  } else {
    const at = body.lastIndexOf("@");
    let userinfo = safeDecode(body.slice(0, at));
    const hostport = body.slice(at + 1);
    if (!userinfo.includes(":") && looksBase64(userinfo)) userinfo = b64decode(userinfo);
    const ci = userinfo.indexOf(":");
    method = userinfo.slice(0, ci);
    password = userinfo.slice(ci + 1);
    const hp = hostport.match(/^\[?([^\]]+?)\]?:(\d+)$/);
    if (!hp) throw new ParseError("Invalid Shadowsocks host");
    host = hp[1];
    port = Number(hp[2]);
  }
  const q = new URLSearchParams(query);
  const plugin = q.get("plugin");
  const cfg: Json = { type: "shadowsocks", server: host, server_port: port, method, password };
  if (plugin) {
    const [pname, ...opts] = safeDecode(plugin).split(";");
    cfg.plugin = pname === "simple-obfs" ? "obfs-local" : pname;
    cfg.plugin_opts = opts.join(";");
  }
  return finish({
    name,
    protocol: "shadowsocks",
    detail: label("Shadowsocks", method),
    host,
    port,
    kind: "outbound",
    raw: link,
    config: cfg,
  });
}

function parseHysteria2(link: string): ParsedProfile {
  const u = parseUrl(link);
  const password = u.pass ? `${u.user}:${u.pass}` : u.user;
  const q = u.q;
  const cfg: Json = {
    type: "hysteria2",
    server: u.host,
    server_port: u.port || 443,
    password,
    tls: compact({
      enabled: true,
      server_name: q.get("sni") || u.host,
      insecure: ["1", "true"].includes(q.get("insecure") ?? "") || undefined,
      alpn: splitList(q.get("alpn")),
    }),
  };
  const ports = q.get("mport") || q.get("ports");
  if (ports) cfg.server_ports = ports.split(",").map((p) => p.replace("-", ":"));
  if (q.get("obfs") && q.get("obfs") !== "none") {
    cfg.obfs = { type: q.get("obfs"), password: q.get("obfs-password") ?? "" };
  }
  return finish({
    name: u.name,
    protocol: "hysteria2",
    detail: "Hysteria2",
    host: u.host,
    port: u.port || 443,
    kind: "outbound",
    raw: link,
    config: cfg,
  });
}

function parseTuic(link: string): ParsedProfile {
  const u = parseUrl(link);
  const q = u.q;
  return finish({
    name: u.name,
    protocol: "tuic",
    detail: "TUIC",
    host: u.host,
    port: u.port || 443,
    kind: "outbound",
    raw: link,
    config: compact({
      type: "tuic",
      server: u.host,
      server_port: u.port || 443,
      uuid: u.user,
      password: u.pass,
      congestion_control: q.get("congestion_control") || "bbr",
      udp_relay_mode: q.get("udp_relay_mode") || undefined,
      tls: compact({
        enabled: true,
        server_name: q.get("sni") || u.host,
        insecure: ["1", "true"].includes(q.get("allow_insecure") ?? q.get("insecure") ?? "") || undefined,
        alpn: splitList(q.get("alpn") ? safeDecode(q.get("alpn")!) : "h3"),
      }),
    }),
  });
}

function parseSsh(link: string): ParsedProfile {
  const u = parseUrl(link);
  if (!u.user) throw new ParseError("SSH link needs a user name: ssh://user:password@host:port");
  const pk = u.q.get("pk") || u.q.get("private_key");
  return finish({
    name: u.name,
    protocol: "ssh",
    detail: label("SSH", pk ? "Key" : "Password"),
    host: u.host,
    port: u.port || 22,
    kind: "outbound",
    raw: link,
    config: compact({
      type: "ssh",
      server: u.host,
      server_port: u.port || 22,
      user: u.user,
      password: u.pass || undefined,
      private_key: pk ? safeDecode(pk) : undefined,
    }),
  });
}

function parseSocksOrHttp(link: string): ParsedProfile {
  const u = parseUrl(link);
  let user = u.user;
  let pass = u.pass;
  if (user && !pass && looksBase64(user)) {
    const dec = b64decode(user);
    const i = dec.indexOf(":");
    if (i > 0) {
      user = dec.slice(0, i);
      pass = dec.slice(i + 1);
    }
  }
  const isHttp = u.scheme.startsWith("http");
  return finish({
    name: u.name,
    protocol: isHttp ? "http" : "socks",
    detail: isHttp ? (u.scheme === "https" ? "HTTPS proxy" : "HTTP proxy") : "SOCKS5",
    host: u.host,
    port: u.port || (isHttp ? 8080 : 1080),
    kind: "outbound",
    raw: link,
    config: compact({
      type: isHttp ? "http" : "socks",
      server: u.host,
      server_port: u.port || (isHttp ? 8080 : 1080),
      username: user || undefined,
      password: pass || undefined,
      tls: u.scheme === "https" ? { enabled: true, server_name: u.host } : undefined,
    }),
  });
}

/** Xray-style wireguard:// link. */
function parseWireguardLink(link: string): ParsedProfile {
  const u = parseUrl(link.replace(/^wg:\/\//i, "wireguard://"));
  const q = u.q;
  const reserved = q.get("reserved");
  return finish({
    name: u.name,
    protocol: "wireguard",
    detail: "WireGuard",
    host: u.host,
    port: u.port || 51820,
    kind: "endpoint",
    raw: link,
    config: {
      type: "wireguard",
      address: splitList(q.get("address") || q.get("ip") || "10.0.0.2/32").map(withPrefix),
      private_key: u.user,
      mtu: Number(q.get("mtu") || 1280),
      peers: [
        compact({
          address: u.host,
          port: u.port || 51820,
          public_key: q.get("publickey") || q.get("publicKey") || q.get("peer_public_key") || "",
          pre_shared_key: q.get("presharedkey") || undefined,
          allowed_ips: ["0.0.0.0/0", "::/0"],
          persistent_keepalive_interval: 25,
          reserved: reserved ? reserved.split(",").map(Number) : undefined,
        }),
      ],
    },
  });
}

function withPrefix(addr: string): string {
  if (addr.includes("/")) return addr;
  return addr.includes(":") ? `${addr}/128` : `${addr}/32`;
}

// ---------- WireGuard .conf (Windscribe, etc.) ----------

export function parseWireguardConf(text: string, name?: string): ParsedProfile {
  const sections: { name: string; kv: Record<string, string> }[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/[#;].*$/, "").trim();
    if (!line) continue;
    const sec = line.match(/^\[(\w+)\]$/);
    if (sec) {
      sections.push({ name: sec[1].toLowerCase(), kv: {} });
      continue;
    }
    const kv = line.match(/^([\w]+)\s*=\s*(.+)$/);
    if (kv && sections.length) {
      const key = kv[1].toLowerCase();
      const cur = sections[sections.length - 1].kv;
      cur[key] = cur[key] ? `${cur[key]},${kv[2].trim()}` : kv[2].trim();
    }
  }
  const iface = sections.find((s) => s.name === "interface")?.kv;
  const peer = sections.find((s) => s.name === "peer")?.kv;
  if (!iface || !peer) throw new ParseError("WireGuard config needs [Interface] and [Peer] sections");
  if (!iface.privatekey) throw new ParseError("WireGuard config has no PrivateKey");
  if (!peer.endpoint) throw new ParseError("WireGuard config has no peer Endpoint");
  const ep = peer.endpoint.match(/^\[?([^\]]+?)\]?:(\d+)$/);
  if (!ep) throw new ParseError("Invalid WireGuard Endpoint");
  const host = ep[1];
  const port = Number(ep[2]);
  return finish({
    name: name || `WireGuard ${host}`,
    protocol: "wireguard",
    detail: "WireGuard",
    host,
    port,
    kind: "endpoint",
    config: {
      type: "wireguard",
      address: splitList(iface.address).map(withPrefix),
      private_key: iface.privatekey,
      mtu: Number(iface.mtu || 1280),
      peers: [
        compact({
          address: host,
          port,
          public_key: peer.publickey,
          pre_shared_key: peer.presharedkey || undefined,
          allowed_ips: splitList(peer.allowedips || "0.0.0.0/0, ::/0"),
          persistent_keepalive_interval: Number(peer.persistentkeepalive || 25),
        }),
      ],
    },
  });
}

// ---------- OpenVPN .ovpn ----------

export function parseOvpn(text: string, opts: ImportOptions = {}): ParsedProfile {
  const blocks: Record<string, string> = {};
  const body = text.replace(/<([\w-]+)>([\s\S]*?)<\/\1>/g, (_m, tag: string, content: string) => {
    blocks[tag.toLowerCase()] = content.trim();
    return "";
  });
  const directives: string[][] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    directives.push(line.split(/\s+/));
  }
  const get = (k: string) => directives.find((d) => d[0].toLowerCase() === k);
  const all = (k: string) => directives.filter((d) => d[0].toLowerCase() === k);

  const defaultProto = (get("proto")?.[1] ?? "udp").toLowerCase().replace(/-client$/, "");
  const defaultPort = Number(get("port")?.[1] ?? 1194);
  const remotes = all("remote").map((d) => ({
    server: d[1],
    server_port: Number(d[2] ?? defaultPort),
    network: (d[3] ?? defaultProto).toLowerCase().startsWith("tcp") ? "tcp" : "udp",
  }));
  if (!remotes.length) throw new ParseError("OpenVPN config has no `remote` line");
  if (!blocks.ca) throw new ParseError("OpenVPN config must embed the CA certificate (<ca>…</ca>)");

  const network = defaultProto.startsWith("tcp") ? "tcp" : "udp";
  const tls: Json = {
    certificate: blocks.ca,
    client_certificate: blocks.cert,
    client_key: blocks.key,
  };
  const keyDir = get("key-direction")?.[1];
  if (blocks["tls-crypt-v2"]) {
    tls.control_wrap = { type: "tls_crypt_v2", key: blocks["tls-crypt-v2"] };
  } else if (blocks["tls-crypt"]) {
    tls.control_wrap = { type: "tls_crypt", key: blocks["tls-crypt"] };
  } else if (blocks["tls-auth"]) {
    tls.control_wrap = compact({
      type: "tls_auth",
      key: blocks["tls-auth"],
      direction: keyDir === "1" ? "client" : keyDir === "0" ? "server" : undefined,
    });
  }
  const verifyName = get("verify-x509-name");
  if (verifyName) {
    tls.server_name = verifyName[1].replace(/^"|"$/g, "");
    const t = verifyName[2];
    if (t === "name-prefix") tls.server_name_type = "name-prefix";
    else if (t === "subject") tls.server_name_type = "subject";
  }
  const rct = get("remote-cert-tls")?.[1];
  if (rct === "server" || rct === "client") tls.remote_certificate_tls = rct;
  const tlsMin = get("tls-version-min")?.[1];
  if (tlsMin && ["1.0", "1.1", "1.2", "1.3"].includes(tlsMin)) tls.version_min = tlsMin;

  const needsAuth = !!get("auth-user-pass");
  let username = opts.username;
  let password = opts.password;
  if (needsAuth && !username) {
    // Some files embed credentials inline: <auth-user-pass>user\npass</auth-user-pass>
    const inline = blocks["auth-user-pass"]?.split(/\r?\n/);
    if (inline && inline.length >= 2) {
      username = inline[0].trim();
      password = inline[1].trim();
    }
  }
  if (needsAuth && !username) {
    throw new ParseError("This OpenVPN config needs a username and password (fill in the OpenVPN credentials fields)");
  }

  const dataCiphers = (get("data-ciphers")?.[1] ?? get("ncp-ciphers")?.[1])?.split(":").filter(Boolean);
  const cipher = get("cipher")?.[1];
  const cfg: Json = compact({
    type: "openvpn-client",
    servers: remotes.length > 1 ? remotes : undefined,
    server: remotes.length === 1 ? remotes[0].server : undefined,
    server_port: remotes.length === 1 ? remotes[0].server_port : undefined,
    network: remotes.length === 1 ? remotes[0].network : network,
    remote_random: get("remote-random") ? true : undefined,
    username: needsAuth ? username : undefined,
    password: needsAuth ? password : undefined,
    tls: compact(tls),
    data_ciphers: dataCiphers?.length ? dataCiphers : undefined,
    data_ciphers_fallback: cipher && !dataCiphers?.length ? cipher : undefined,
    auth: get("auth")?.[1],
    compression_lzo: get("comp-lzo") ? "no" : undefined,
    allow_compression: get("comp-lzo") || get("compress") ? "asym" : undefined,
    // We route everything ourselves; ignore pushed routes/DNS.
    route_no_pull: true,
  });
  if (cfg.network === "udp") delete cfg.network;
  const first = remotes[0];
  return finish({
    name: opts.name || `OpenVPN ${first.server}`,
    protocol: "openvpn",
    detail: label("OpenVPN", first.network.toUpperCase()),
    host: first.server,
    port: first.server_port,
    kind: "endpoint",
    config: cfg,
  });
}

// ---------- SSH form ----------

export function profileFromSshForm(f: SshForm): ParsedProfile {
  if (!f.host) throw new ParseError("Host is required");
  if (!f.user) throw new ParseError("User is required");
  if (!f.password && !f.privateKey) throw new ParseError("Password or private key is required");
  return finish({
    name: f.name || `SSH ${f.host}`,
    protocol: "ssh",
    detail: label("SSH", f.privateKey ? "Key" : "Password"),
    host: f.host,
    port: f.port || 22,
    kind: "outbound",
    config: compact({
      type: "ssh",
      server: f.host,
      server_port: f.port || 22,
      user: f.user,
      password: f.password || undefined,
      private_key: f.privateKey || undefined,
    }),
  });
}

// ---------- sing-box JSON ----------

const SB_OUTBOUND_PROTOCOLS: Record<string, Protocol> = {
  vmess: "vmess",
  vless: "vless",
  trojan: "trojan",
  shadowsocks: "shadowsocks",
  hysteria2: "hysteria2",
  tuic: "tuic",
  socks: "socks",
  http: "http",
  ssh: "ssh",
  wireguard: "wireguard",
  "openvpn-client": "openvpn",
};

function fromSingboxObject(o: Json): ParsedProfile | null {
  const type = String(o.type ?? "");
  const protocol = SB_OUTBOUND_PROTOCOLS[type];
  if (!protocol) return null;
  const cfg = { ...o };
  const name = String(cfg.tag ?? "");
  delete cfg.tag;
  delete cfg.detour;
  const isEndpoint = type === "wireguard" || type === "openvpn-client";
  const peer = (cfg.peers as Json[] | undefined)?.[0];
  const host = String(cfg.server ?? peer?.address ?? "");
  const port = Number(cfg.server_port ?? peer?.port ?? 0);
  return finish({
    name,
    protocol,
    detail: protocol.toUpperCase(),
    host,
    port,
    kind: isEndpoint ? "endpoint" : "outbound",
    config: cfg,
  });
}

function parseSingboxJson(text: string): ParsedProfile[] {
  const j = JSON.parse(text) as Json | Json[];
  const list: Json[] = Array.isArray(j)
    ? j
    : [...((j.outbounds as Json[]) ?? []), ...((j.endpoints as Json[]) ?? []), ...(j.type ? [j] : [])];
  return list.map(fromSingboxObject).filter((p): p is ParsedProfile => !!p);
}

// ---------- entry point ----------

export function parseLink(link: string): ParsedProfile {
  const scheme = link.slice(0, link.indexOf("://")).toLowerCase();
  switch (scheme) {
    case "vmess":
      return parseVmess(link);
    case "vless":
      return parseVless(link);
    case "trojan":
      return parseTrojan(link);
    case "ss":
      return parseShadowsocks(link);
    case "hysteria2":
    case "hy2":
      return parseHysteria2(link);
    case "tuic":
      return parseTuic(link);
    case "ssh":
      return parseSsh(link);
    case "socks":
    case "socks5":
    case "http":
    case "https":
      return parseSocksOrHttp(link);
    case "wireguard":
    case "wg":
      return parseWireguardLink(link);
    default:
      throw new ParseError(`Unsupported link type "${scheme}://"`);
  }
}

const LINK_RE = /^(vmess|vless|trojan|ss|hysteria2|hy2|tuic|ssh|socks5?|wireguard|wg):\/\//i;

export interface ParseOutcome {
  profiles: ParsedProfile[];
  errors: { input: string; reason: string }[];
}

/**
 * Detects what kind of content `text` is and parses all configs out of it.
 * `isSubscriptionBody` allows http(s):// lines to be ignored instead of treated as proxies.
 */
export function parseAny(text: string, opts: ImportOptions = {}, fileName?: string): ParseOutcome {
  const out: ParseOutcome = { profiles: [], errors: [] };
  let t = text.replace(/^﻿/, "").trim();
  if (!t) return out;
  const baseName = fileName?.replace(/\.[^.]+$/, "");

  const tryPush = (input: string, fn: () => ParsedProfile | ParsedProfile[]) => {
    try {
      const r = fn();
      out.profiles.push(...(Array.isArray(r) ? r : [r]));
    } catch (e) {
      out.errors.push({ input: input.slice(0, 80), reason: (e as Error).message });
    }
  };

  // WireGuard conf
  if (/^\s*\[Interface\]/im.test(t) && /\[Peer\]/i.test(t)) {
    tryPush(baseName ?? "WireGuard config", () => parseWireguardConf(t, opts.name || baseName));
    return out;
  }
  // OpenVPN
  if (/^\s*(client|remote\s+\S+)/im.test(t) && (/<ca>/i.test(t) || /^\s*dev\s+tun/im.test(t))) {
    tryPush(baseName ?? "OpenVPN config", () => parseOvpn(t, { ...opts, name: opts.name || baseName }));
    return out;
  }
  // JSON (sing-box)
  if (t.startsWith("{") || t.startsWith("[")) {
    tryPush("JSON", () => {
      const r = parseSingboxJson(t);
      if (!r.length) throw new ParseError("No supported outbounds found in JSON");
      return r;
    });
    return out;
  }
  // Base64-encoded subscription body
  if (!LINK_RE.test(t) && looksBase64(t)) {
    try {
      const dec = b64decode(t);
      if (LINK_RE.test(dec.trim()) || dec.includes("://")) t = dec.trim();
    } catch {
      /* not base64 */
    }
  }
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (!line.includes("://")) continue;
    // A single http(s) URL in the paste box is treated as a subscription by the caller.
    tryPush(line, () => parseLink(line));
  }
  if (!out.profiles.length && !out.errors.length) {
    out.errors.push({ input: t.slice(0, 80), reason: "No recognised configs found" });
  }
  return out;
}

/** Best-effort conversion of a profile back to a shareable link. */
export function toLink(p: Profile): string {
  if (p.raw) return p.raw;
  const c = p.config as Json;
  if (p.protocol === "ssh") {
    const pass = c.password ? `:${encodeURIComponent(String(c.password))}` : "";
    return `ssh://${encodeURIComponent(String(c.user))}${pass}@${p.host}:${p.port}#${encodeURIComponent(p.name)}`;
  }
  return JSON.stringify({ tag: p.name, ...c }, null, 2);
}
