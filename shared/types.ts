// Types shared between the Electron main process and the Next.js renderer.

export type Protocol =
  | "vmess"
  | "vless"
  | "trojan"
  | "shadowsocks"
  | "hysteria2"
  | "tuic"
  | "socks"
  | "http"
  | "ssh"
  | "wireguard"
  | "openvpn";

/** Coarse grouping used for the filter chips in the UI. */
export type ProfileGroup = "v2ray" | "ssh" | "wireguard" | "openvpn";

export interface Profile {
  id: string;
  name: string;
  protocol: Protocol;
  /** Short transport/security description, e.g. "WS · TLS" */
  detail: string;
  host: string;
  port: number;
  /** "outbound" or "endpoint" – where the JSON goes in the sing-box config. */
  kind: "outbound" | "endpoint";
  /** sing-box outbound/endpoint options (without `tag`). */
  config: Record<string, unknown>;
  /** Original share link, when imported from one. */
  raw?: string;
  /** ISO 3166-1 alpha-2 code (upper case), guessed from the name or learned after connecting. */
  country?: string;
  /** Last measured delay in ms. -1 = timeout / failed, undefined = never tested. */
  ping?: number;
  pingAt?: number;
  createdAt: number;
  lastUsedAt?: number;
  subscriptionId?: string;
  favorite?: boolean;
}

export interface Subscription {
  id: string;
  name: string;
  url: string;
  updatedAt?: number;
  error?: string;
}

export interface KillSwitchSettings {
  enabled: boolean;
  /** Domains (suffix match), IPs or CIDRs that always bypass the VPN. */
  exceptions: string[];
}

export interface Settings {
  killSwitch: KillSwitchSettings;
  remoteDns: string;
  tunStack: "mixed" | "system" | "gvisor";
  mtu: number;
  ipv6: boolean;
  pingUrl: string;
  pingTimeout: number;
  connectOnLaunch: boolean;
  /** Start Anti VPN automatically when Windows starts. */
  launchAtStartup: boolean;
  /** Show Windows notifications for connection events when the app is in the background. */
  systemNotifications: boolean;
  autoReconnect: boolean;
  theme: "light" | "dark" | "system";
  lastProfileId?: string;
  sortBy: "ping" | "name" | "recent";
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnecting";

export interface PublicIpInfo {
  ip: string;
  country?: string;
  countryCode?: string;
  city?: string;
  isp?: string;
}

export type ConnectPhase = "starting" | "connecting" | "verifying";

export interface ReconnectInfo {
  /** 1-based attempt number */
  attempt: number;
  /** 0 = unlimited (kill switch on) */
  max: number;
  /** epoch ms of the next attempt */
  nextAt: number;
}

export interface VpnState {
  status: ConnectionStatus;
  profileId?: string;
  /** Progress while connecting / reconnecting. */
  phase?: ConnectPhase;
  reconnect?: ReconnectInfo;
  /** Raw technical message behind `error` (shown under "Details"). */
  errorDetail?: string;
  /** epoch ms when the current session became connected */
  since?: number;
  error?: string;
  /** True while the kill switch is actively blocking traffic (VPN down but supposed to be on). */
  blocking: boolean;
  publicIp?: PublicIpInfo;
}

export interface TrafficSample {
  t: number;
  /** bytes per second */
  up: number;
  down: number;
}

export interface TrafficSnapshot {
  current: TrafficSample;
  sessionUp: number;
  sessionDown: number;
  /** seconds the session has been running */
  sessionSeconds: number;
  avgUp: number;
  avgDown: number;
  peakDown: number;
  peakUp: number;
}

export interface DailyStat {
  /** YYYY-MM-DD (local time) */
  date: string;
  seconds: number;
  up: number;
  down: number;
}

export interface SpeedTestResult {
  downloadMbps: number;
  latencyMs: number;
  at: number;
}

export interface CoreInfo {
  found: boolean;
  path: string;
  version?: string;
}

export interface SystemInfo {
  isAdmin: boolean;
  core: CoreInfo;
  platform: string;
  appVersion: string;
}

export interface ImportResult {
  added: Profile[];
  errors: { input: string; reason: string }[];
}

export interface ImportOptions {
  /** Credentials for OpenVPN profiles that use auth-user-pass. */
  username?: string;
  password?: string;
  name?: string;
}

export interface SshForm {
  name: string;
  host: string;
  port: number;
  user: string;
  password?: string;
  privateKey?: string;
}

export interface LogLine {
  t: number;
  level: "info" | "warn" | "error";
  msg: string;
}

export interface VpnApi {
  getSystemInfo(): Promise<SystemInfo>;
  // profiles
  listProfiles(): Promise<Profile[]>;
  importText(text: string, opts?: ImportOptions): Promise<ImportResult>;
  importFiles(opts?: ImportOptions): Promise<ImportResult>;
  /** Imports whatever configs / subscription links are on the clipboard. */
  importClipboard(): Promise<ImportResult>;
  addSsh(form: SshForm): Promise<ImportResult>;
  updateProfile(id: string, patch: Partial<Pick<Profile, "name" | "config" | "country" | "favorite">>): Promise<Profile>;
  removeProfiles(ids: string[]): Promise<void>;
  pingAll(ids?: string[]): Promise<void>;
  exportLink(id: string): Promise<string>;
  // subscriptions
  listSubscriptions(): Promise<Subscription[]>;
  addSubscription(url: string, name?: string): Promise<ImportResult>;
  refreshSubscription(id: string): Promise<ImportResult>;
  removeSubscription(id: string): Promise<void>;
  // connection
  connect(profileId: string): Promise<void>;
  disconnect(): Promise<void>;
  reconnectNow(): Promise<void>;
  relaunchAsAdmin(): Promise<void>;
  getState(): Promise<VpnState>;
  getTraffic(): Promise<{ snapshot: TrafficSnapshot | null; history: TrafficSample[] }>;
  runSpeedTest(): Promise<SpeedTestResult>;
  // settings & stats
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  getDailyStats(days: number): Promise<DailyStat[]>;
  getLogs(): Promise<LogLine[]>;
  openExternal(url: string): Promise<void>;
  // events – each returns an unsubscribe function
  onState(cb: (s: VpnState) => void): () => void;
  onTraffic(cb: (s: TrafficSnapshot) => void): () => void;
  onProfiles(cb: (p: Profile[]) => void): () => void;
  onPingProgress(cb: (p: { done: number; total: number; running: boolean }) => void): () => void;
  onLog(cb: (l: LogLine) => void): () => void;
}
