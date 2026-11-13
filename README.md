<p align="center">
  <img src="build/icon.png" width="96" alt="Anti VPN" />
</p>

<h1 align="center">Anti VPN</h1>

<p align="center">
  A minimal Windows desktop VPN client for <b>V2Ray</b>, <b>SSH</b>, <b>WireGuard</b> and <b>OpenVPN</b> configs, with a real Kill Switch.
  <br />
  <a href="README.fa.md">فارسی</a>
</p>

---

## Features

- **Every common config type**
  - V2Ray links: `vless://` (incl. Reality), `vmess://`, `trojan://`, `ss://`, `hysteria2://`, `tuic://`. Transports: TCP, WebSocket, gRPC, HTTP/2, HTTPUpgrade.
  - SSH: password or private key.
  - WireGuard `.conf` and OpenVPN `.ovpn` (e.g. Windscribe). OpenVPN runs natively, so no extra install is needed.
  - Subscription URLs (base64 or plain lists) and sing-box JSON.
- **Add configs your way**: pick the type, then enter it manually, paste it, or import a file. Paste many links and subscriptions at once, or press <kbd>Ctrl</kbd>+<kbd>V</kbd> anywhere in the app.
- **Ping all**: a real request through every config (default target: YouTube), with live progress per config and sorting by ping.
- **Kill Switch**: turn it on once and it protects every connection. If the VPN drops, the internet is blocked. Exceptions (domains, `.ir`, IPs and CIDRs) always use the normal connection.
- **Auto-reconnect** with backoff and a countdown. With the Kill Switch on, it never gives up and nothing leaks.
- **Full-system tunnel (TUN)**: all apps go through the VPN, with DNS leak protection.
- **Live speed**: current, average and peak speed, a speed test, and 7-day usage charts.
- **Designed feedback**: in-app dialogs, toasts and error pages, plus Windows notifications with action buttons (Reconnect now / Disconnect).
- Light and dark themes, a responsive layout (bottom navigation on narrow windows), launch at startup, and connect on launch.

## Tech stack

| Layer | Tech |
| --- | --- |
| Shell | Electron (main process in TypeScript) |
| UI | Next.js (static export), React, TypeScript, Tailwind CSS v4, shadcn/ui (Base UI), Recharts |
| Engine | [sing-box](https://github.com/SagerNet/sing-box) 1.14 (V2Ray protocols, SSH, WireGuard, OpenVPN, TUN, Clash API) |

```
electron/   main process: VPN state machine, sing-box process, ping, parsers, notifications
shared/     types shared by main and renderer
src/        Next.js renderer (views, dialogs, map, charts)
scripts/    fetch-core (downloads sing-box), copy-flags
build/      app / installer icons
```

## Getting started

Requirements: Windows 10/11 x64 and Node.js 22+.

```bash
npm install          # also copies the flag icons
npm run fetch-core   # downloads sing-box into resources/bin
npm run dev          # run from an Administrator terminal (TUN needs admin)
```

The renderer also runs in a normal browser at `http://localhost:3123` with mock data, which is handy for UI work.

## Build the installer

```bash
npm run dist
```

This produces `release/AntiVPN-Setup-<version>.exe`. The installer bundles everything (the sing-box engine, flags and icons) and asks for administrator rights.

## How the Kill Switch works

When the VPN is on, sing-box captures all traffic through a TUN interface with strict routing. If the server stops responding, traffic simply fails instead of falling back to your real connection. If the engine itself stops, a "blocker" configuration takes over until the VPN is back. Exceptions are routed directly, before the VPN. When you disconnect on purpose, everything is released.

## Licenses

- Anti VPN source code: all rights reserved by the author unless a license file is added.
- [sing-box](https://github.com/SagerNet/sing-box) is GPL-3.0 and is downloaded at build time.
- Flags: [circle-flags](https://github.com/HatScripts/circle-flags) (MIT).
