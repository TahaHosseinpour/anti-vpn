import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, net, protocol, shell } from "electron";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import type { ImportOptions, ImportResult, LogLine, Settings, SystemInfo } from "../shared/types";
import { isAutostartEnabled, launchedAtLogin, setAutostart } from "./autostart";
import { getCoreInfo } from "./core";
import { notifyTransition, PROTOCOL } from "./notify";
import { toLink } from "./parsers";
import { pingProfiles } from "./ping";
import { ProfileService } from "./profiles";
import { Store, todayKey } from "./store";
import { VpnManager } from "./vpn";

const isDev = !app.isPackaged;
const DEV_URL = process.env.ANTIVPN_DEV_URL ?? "http://localhost:3123";

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win: BrowserWindow | null = null;
let store: Store;
let profiles: ProfileService;
let vpn: VpnManager;
let isAdmin = false;
const logs: LogLine[] = [];

function checkAdmin(): boolean {
  try {
    execFileSync("net", ["session"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** Restarts the app elevated (shows the Windows UAC prompt). Keeps running if the user cancels. */
function relaunchAsAdmin(): Promise<void> {
  const args = app.isPackaged ? [] : [app.getAppPath()];
  const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
  const argList = args.length ? ` -ArgumentList ${args.map((a) => q(`"${a}"`)).join(",")}` : "";
  const cmd = `Start-Process -FilePath ${q(process.execPath)}${argList} -Verb RunAs`;
  return new Promise((resolve, reject) => {
    execFile("powershell", ["-NoProfile", "-Command", cmd], { windowsHide: true }, (err) => {
      if (err) return reject(new Error("RELAUNCH_CANCELLED"));
      app.releaseSingleInstanceLock();
      app.quit();
      resolve();
    });
  });
}

function send(channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function pushLog(level: LogLine["level"], msg: string) {
  const line: LogLine = { t: Date.now(), level, msg };
  logs.push(line);
  if (logs.length > 600) logs.shift();
  send("log", line);
}

let profilesTimer: NodeJS.Timeout | null = null;
function broadcastProfiles() {
  if (profilesTimer) return;
  profilesTimer = setTimeout(() => {
    profilesTimer = null;
    send("profiles", store.profiles.data);
  }, 120);
}

function titleBarColors(theme: Settings["theme"]) {
  const dark = theme === "dark" || (theme === "system" && nativeTheme.shouldUseDarkColors);
  return { color: "#00000000", symbolColor: dark ? "#e5e5e5" : "#171717", height: 36 };
}

function createWindow() {
  const theme = store.settings.data.theme;
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: "Anti VPN",
    backgroundColor: titleBarColors(theme).symbolColor === "#e5e5e5" ? "#050505" : "#f5f5f5",
    titleBarStyle: "hidden",
    titleBarOverlay: titleBarColors(theme),
    autoHideMenuBar: true,
    icon: isDev ? join(app.getAppPath(), "build", "icon.png") : undefined,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => {
    if (launchedAtLogin()) win?.showInactive();
    else win?.show();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (isDev) void win.loadURL(DEV_URL);
  else void win.loadURL("app://bundle/");
}

function registerAppProtocol() {
  const root = join(__dirname, "..", "..", "out");
  protocol.handle("app", (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p.endsWith("/")) p += "index.html";
    let file = normalize(join(root, p));
    if (!file.startsWith(root)) return new Response("Forbidden", { status: 403 });
    if (!existsSync(file) || statSync(file).isDirectory()) {
      if (existsSync(file + ".html")) file += ".html";
      else if (!extname(file)) file = join(root, "index.html");
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

async function runPing(ids?: string[]) {
  if (pingRunning) return;
  pingRunning = true;
  const list = ids?.length ? store.profiles.data.filter((p) => ids.includes(p.id)) : store.profiles.data;
  try {
    await pingProfiles(
      list,
      store.settings.data,
      (id, ms) => {
        profiles.setPing(id, ms);
        broadcastProfiles();
      },
      (done, total) => send("ping-progress", { done, total, running: done < total }),
      (l) => pushLog("info", l),
    );
  } finally {
    pingRunning = false;
    send("ping-progress", { done: list.length, total: list.length, running: false });
    broadcastProfiles();
  }
}
let pingRunning = false;

/**
 * Imports a pasted batch: any mix of share links, subscription URLs (one per line),
 * WireGuard / OpenVPN files or sing-box JSON.
 */
async function importBatch(text: string, opts?: ImportOptions): Promise<ImportResult> {
  const out: ImportResult = { added: [], errors: [] };
  const t = text.trim();
  if (!t) return { added: [], errors: [{ input: "", reason: "The clipboard is empty" }] };
  const isSubUrl = (l: string) => /^https?:\/\/\S+$/i.test(l) && !/^https?:\/\/[^/]*@/.test(l);
  // Whole-file formats are passed through untouched.
  if (/\[Interface\]/i.test(t) || /<ca>/i.test(t) || t.startsWith("{") || t.startsWith("[")) {
    return profiles.importText(t, opts);
  }
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const subs = lines.filter(isSubUrl);
  const rest = lines.filter((l) => !isSubUrl(l));
  for (const url of subs) {
    try {
      const r = await profiles.addSubscription(url, subs.length === 1 ? opts?.name : undefined);
      out.added.push(...r.added);
      out.errors.push(...r.errors);
    } catch (e) {
      out.errors.push({ input: url, reason: (e as Error).message });
    }
  }
  if (rest.length) {
    const r = profiles.importText(rest.join("\n"), opts);
    out.added.push(...r.added);
    out.errors.push(...r.errors);
  }
  return out;
}

function registerIpc() {
  const h = <A extends unknown[], R>(ch: string, fn: (...a: A) => R | Promise<R>) =>
    ipcMain.handle(ch, (_e, ...args) => fn(...(args as A)));

  h("system:info", async (): Promise<SystemInfo> => ({
    isAdmin,
    core: await getCoreInfo(),
    platform: process.platform,
    appVersion: app.getVersion(),
  }));

  h("profiles:list", () => store.profiles.data);
  h("profiles:importText", (text: string, opts?: ImportOptions) => importBatch(text, opts));
  h("profiles:importClipboard", async () => importBatch(await clipboard.readText()));
  h("profiles:importFiles", async (opts?: ImportOptions): Promise<ImportResult> => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Import configs",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "VPN configs", extensions: ["conf", "ovpn", "txt", "json"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    const out: ImportResult = { added: [], errors: [] };
    for (const f of r.filePaths) {
      const res = profiles.importText(readFileSync(f, "utf8"), { ...opts, name: undefined }, basename(f));
      out.added.push(...res.added);
      out.errors.push(...res.errors.map((e) => ({ ...e, input: basename(f) })));
    }
    return out;
  });
  h("profiles:addSsh", (form) => profiles.addSsh(form as never));
  h("profiles:update", (id: string, patch) => profiles.update(id, patch as never));
  h("profiles:remove", async (ids: string[]) => {
    if (vpn.state.profileId && ids.includes(vpn.state.profileId) && vpn.state.status !== "disconnected") {
      await vpn.disconnect();
    }
    profiles.remove(ids);
  });
  h("profiles:pingAll", (ids?: string[]) => {
    void runPing(ids);
  });
  h("profiles:exportLink", (id: string) => {
    const p = store.profiles.data.find((x) => x.id === id);
    if (!p) throw new Error("Config not found");
    return toLink(p);
  });

  h("subs:list", () => profiles.listSubscriptions());
  h("subs:add", (url: string, name?: string) => profiles.addSubscription(url, name));
  h("subs:refresh", (id: string) => profiles.refreshSubscription(id));
  h("subs:remove", (id: string) => profiles.removeSubscription(id));

  h("vpn:connect", (id: string) => vpn.connect(id));
  h("vpn:disconnect", () => vpn.disconnect());
  h("vpn:reconnectNow", () => vpn.reconnectNow());
  h("app:relaunchAsAdmin", () => relaunchAsAdmin());
  h("vpn:state", () => vpn.state);
  h("vpn:traffic", () => ({ snapshot: vpn.snapshot, history: vpn.history }));
  h("vpn:speedTest", () => vpn.speedTest());

  h("settings:get", () => store.settings.data);
  h("settings:set", async (patch: Partial<Settings>) => {
    const prev = store.settings.data;
    if (patch.launchAtStartup !== undefined && patch.launchAtStartup !== prev.launchAtStartup) {
      await setAutostart(patch.launchAtStartup);
    }
    const next: Settings = {
      ...prev,
      ...patch,
      killSwitch: { ...prev.killSwitch, ...(patch.killSwitch ?? {}) },
    };
    store.settings.data = next;
    store.settings.save();
    if (patch.theme && win) win.setTitleBarOverlay(titleBarColors(next.theme));
    const affectsTunnel =
      JSON.stringify(prev.killSwitch) !== JSON.stringify(next.killSwitch) ||
      prev.remoteDns !== next.remoteDns ||
      prev.tunStack !== next.tunStack ||
      prev.mtu !== next.mtu ||
      prev.ipv6 !== next.ipv6;
    if (affectsTunnel) void vpn.applySettings();
    return next;
  });

  h("stats:daily", (days: number) => {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = todayKey(d);
      out.push(store.stats.data[key] ?? { date: key, seconds: 0, up: 0, down: 0 });
    }
    return out;
  });
  h("logs:get", () => logs);
  h("shell:open", (url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url);
  });
}

app.setAppUserModelId("app.antivpn.desktop");
if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);
else app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [app.getAppPath()]);

app.whenReady().then(async () => {
  isAdmin = checkAdmin();
  store = new Store();
  profiles = new ProfileService(store, broadcastProfiles);
  vpn = new VpnManager(store, () => isAdmin);
  let lastState = vpn.state;
  vpn.on("state", (s) => {
    send("state", s);
    const prev = lastState;
    lastState = s;
    const inFront = !!win && win.isVisible() && win.isFocused() && !win.isMinimized();
    if (store.settings.data.systemNotifications && !inFront) {
      const profile = store.profiles.data.find((p) => p.id === (s.profileId ?? prev.profileId));
      notifyTransition(prev, s, profile);
    }
  });
  vpn.on("traffic", (t) => send("traffic", t));
  vpn.on("log", (level, msg) => pushLog(level, msg));
  vpn.on("profileUpdated", () => broadcastProfiles());

  // Keep the setting in sync with the actual scheduled task (it may have been removed manually).
  void isAutostartEnabled().then((on) => {
    if (store.settings.data.launchAtStartup !== on) {
      store.settings.data.launchAtStartup = on;
      store.settings.save();
    }
  });

  if (!isDev) registerAppProtocol();
  registerIpc();
  createWindow();
  pushLog("info", `Anti VPN started (${isAdmin ? "administrator" : "standard user"})`);

  // Launched by a notification button while the app was closed.
  const launchLink = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (launchLink) win?.webContents.once("did-finish-load", () => handleProtocol(launchLink));

  const s = store.settings.data;
  if (s.connectOnLaunch && s.lastProfileId && isAdmin) {
    vpn.connect(s.lastProfileId).catch((e) => pushLog("error", String(e)));
  }
});

function focusWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Handles antivpn://<action> links coming from notification buttons. */
function handleProtocol(url: string) {
  const action = url.replace(`${PROTOCOL}://`, "").replace(/\/+$/, "");
  if (action === "reconnect") void vpn.reconnectNow();
  else if (action === "disconnect") void vpn.disconnect();
  else if (action === "connect") {
    const id = store.settings.data.lastProfileId;
    if (id) vpn.connect(id).catch((e) => pushLog("error", String(e)));
    focusWindow();
  } else focusWindow();
}

app.on("second-instance", (_e, argv) => {
  const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (link) handleProtocol(link);
  else focusWindow();
});

let quitting = false;
app.on("before-quit", (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  void (async () => {
    try {
      await vpn?.shutdown();
      store?.flush();
    } finally {
      app.exit(0);
    }
  })();
});

app.on("window-all-closed", () => app.quit());
