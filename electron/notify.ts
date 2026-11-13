// Windows system notifications (toasts) for connection events, with action buttons.
// Buttons use the antivpn:// protocol, which is routed back into the running app.

import { app, Notification } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Profile, VpnState } from "../shared/types";
import { countryName } from "../shared/countries";

export const PROTOCOL = "antivpn";

function iconPath(): string | undefined {
  const p = app.isPackaged ? join(process.resourcesPath, "icon.png") : join(app.getAppPath(), "build", "icon.png");
  return existsSync(p) ? p : undefined;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface ToastAction {
  label: string;
  action: "reconnect" | "disconnect" | "open" | "connect";
}

function show(title: string, body: string, opts: { actions?: ToastAction[]; tag: string; silent?: boolean; attribution?: string }) {
  if (!Notification.isSupported()) return;
  const icon = iconPath();
  const actions = opts.actions ?? [];
  const xml = `<toast launch="${PROTOCOL}://open" activationType="protocol">
  <visual>
    <binding template="ToastGeneric">
      <text>${esc(title)}</text>
      <text>${esc(body)}</text>
      ${opts.attribution ? `<text placement="attribution">${esc(opts.attribution)}</text>` : ""}
      ${icon ? `<image placement="appLogoOverride" hint-crop="none" src="${esc(pathToFileURL(icon).toString())}"/>` : ""}
    </binding>
  </visual>
  ${actions.length ? `<actions>${actions.map((a) => `<action content="${esc(a.label)}" activationType="protocol" arguments="${PROTOCOL}://${a.action}"/>`).join("")}</actions>` : ""}
  ${opts.silent ? `<audio silent="true"/>` : ""}
</toast>`;
  const n =
    process.platform === "win32"
      ? new Notification({ toastXml: xml })
      : new Notification({ title, body, icon, silent: opts.silent });
  n.show();
  // keep a reference so it is not garbage collected before it shows
  current.set(opts.tag, n);
}

const current = new Map<string, Notification>();

/** Decides which notification (if any) a state transition deserves. */
export function notifyTransition(prev: VpnState, next: VpnState, profile: Profile | undefined) {
  const where = profile ? (profile.country ? `${countryName(profile.country)} · ${profile.name}` : profile.name) : "your server";

  if (next.status === "connected" && prev.status === "connecting") {
    show("Connected", `You're protected. Traffic is going through ${where}.`, {
      tag: "state",
      silent: true,
      attribution: "Anti VPN",
      actions: [{ label: "Disconnect", action: "disconnect" }],
    });
  } else if (next.status === "reconnecting" && prev.status !== "reconnecting") {
    show(
      "Connection lost",
      next.blocking
        ? `${where} stopped responding. Reconnecting… Kill Switch is blocking traffic so nothing leaks.`
        : `${where} stopped responding. Reconnecting automatically…`,
      {
        tag: "state",
        attribution: next.blocking ? "Kill Switch active" : "Anti VPN",
        actions: [
          { label: "Reconnect now", action: "reconnect" },
          { label: "Disconnect", action: "disconnect" },
        ],
      },
    );
  } else if (next.status === "connected" && prev.status === "reconnecting") {
    show("Connection restored", `You're protected again through ${where}.`, { tag: "state", silent: true, attribution: "Anti VPN" });
  } else if (next.status === "disconnected" && prev.status !== "disconnected" && next.error) {
    show("Disconnected", next.error, {
      tag: "state",
      attribution: "Anti VPN",
      actions: [
        { label: "Try again", action: "connect" },
        { label: "Open Anti VPN", action: "open" },
      ],
    });
  }
}
