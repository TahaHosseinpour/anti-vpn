export function formatBytes(n: number, digits = 1): string {
  if (!n || n < 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v.toFixed(i === 0 ? 0 : v < 10 ? digits : Math.max(0, digits - 1))} ${u[i]}`;
}

/** bytes/s → "12.4 Mbps" */
export function formatSpeed(bytesPerSec: number): { value: string; unit: string } {
  const bits = Math.max(0, bytesPerSec) * 8;
  if (bits >= 1e6) return { value: (bits / 1e6).toFixed(bits >= 1e8 ? 0 : 1), unit: "Mbps" };
  if (bits >= 1e3) return { value: (bits / 1e3).toFixed(0), unit: "Kbps" };
  return { value: bits.toFixed(0), unit: "bps" };
}

export function speedText(bytesPerSec: number): string {
  const s = formatSpeed(bytesPerSec);
  return `${s.value} ${s.unit}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

export type PingTone = "good" | "ok" | "bad" | "fail" | "none";

export function pingTone(ms?: number): PingTone {
  if (ms === undefined) return "none";
  if (ms < 0) return "fail";
  if (ms < 300) return "good";
  if (ms < 700) return "ok";
  return "bad";
}

export const PROTOCOL_LABEL: Record<string, string> = {
  vmess: "VMess",
  vless: "VLESS",
  trojan: "Trojan",
  shadowsocks: "Shadowsocks",
  hysteria2: "Hysteria2",
  tuic: "TUIC",
  socks: "SOCKS",
  http: "HTTP",
  ssh: "SSH",
  wireguard: "WireGuard",
  openvpn: "OpenVPN",
};

export function protocolGroup(p: string): "v2ray" | "ssh" | "wireguard" | "openvpn" {
  if (p === "ssh") return "ssh";
  if (p === "wireguard") return "wireguard";
  if (p === "openvpn") return "openvpn";
  return "v2ray";
}
