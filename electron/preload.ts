import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import type { VpnApi } from "../shared/types";

const invoke = (ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args);

function on<T>(ch: string, cb: (v: T) => void) {
  const listener = (_e: IpcRendererEvent, v: T) => cb(v);
  ipcRenderer.on(ch, listener);
  return () => {
    ipcRenderer.removeListener(ch, listener);
  };
}

const api: VpnApi = {
  getSystemInfo: () => invoke("system:info"),
  listProfiles: () => invoke("profiles:list"),
  importText: (text, opts) => invoke("profiles:importText", text, opts),
  importFiles: (opts) => invoke("profiles:importFiles", opts),
  importClipboard: () => invoke("profiles:importClipboard"),
  addSsh: (form) => invoke("profiles:addSsh", form),
  updateProfile: (id, patch) => invoke("profiles:update", id, patch),
  removeProfiles: (ids) => invoke("profiles:remove", ids),
  pingAll: (ids) => invoke("profiles:pingAll", ids),
  exportLink: (id) => invoke("profiles:exportLink", id),
  listSubscriptions: () => invoke("subs:list"),
  addSubscription: (url, name) => invoke("subs:add", url, name),
  refreshSubscription: (id) => invoke("subs:refresh", id),
  removeSubscription: (id) => invoke("subs:remove", id),
  connect: (id) => invoke("vpn:connect", id),
  disconnect: () => invoke("vpn:disconnect"),
  reconnectNow: () => invoke("vpn:reconnectNow"),
  relaunchAsAdmin: () => invoke("app:relaunchAsAdmin"),
  getState: () => invoke("vpn:state"),
  getTraffic: () => invoke("vpn:traffic"),
  runSpeedTest: () => invoke("vpn:speedTest"),
  getSettings: () => invoke("settings:get"),
  setSettings: (patch) => invoke("settings:set", patch),
  getDailyStats: (days) => invoke("stats:daily", days),
  getLogs: () => invoke("logs:get"),
  openExternal: (url) => invoke("shell:open", url),
  onState: (cb) => on("state", cb),
  onTraffic: (cb) => on("traffic", cb),
  onProfiles: (cb) => on("profiles", cb),
  onPingProgress: (cb) => on("ping-progress", cb),
  onLog: (cb) => on("log", cb),
};

contextBridge.exposeInMainWorld("vpn", api);
