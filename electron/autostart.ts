// Launch-at-login for an app that needs administrator rights.
// Windows' normal "Run" registry key silently skips elevated apps, so we register a
// Task Scheduler task that runs at logon with highest privileges instead.

import { app } from "electron";
import { execFile } from "node:child_process";

const TASK = "Anti VPN";

function schtasks(args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile("schtasks", args, { windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout}${stderr}`.trim() });
    });
  });
}

function launchCommand(): string {
  // Packaged: the app exe. Dev: electron.exe + project path.
  const exe = `"${process.execPath}"`;
  return app.isPackaged ? `${exe} --autostart` : `${exe} "${app.getAppPath()}" --autostart`;
}

export async function isAutostartEnabled(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  return (await schtasks(["/Query", "/TN", TASK])).ok;
}

export async function setAutostart(enabled: boolean): Promise<void> {
  if (process.platform !== "win32") return;
  if (enabled) {
    const r = await schtasks(["/Create", "/TN", TASK, "/TR", launchCommand(), "/SC", "ONLOGON", "/RL", "HIGHEST", "/F"]);
    if (!r.ok) throw new Error(`Could not enable launch at startup: ${r.out}`);
  } else if (await isAutostartEnabled()) {
    const r = await schtasks(["/Delete", "/TN", TASK, "/F"]);
    if (!r.ok) throw new Error(`Could not disable launch at startup: ${r.out}`);
  }
}

export const launchedAtLogin = () => process.argv.includes("--autostart");
