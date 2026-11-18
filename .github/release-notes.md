## Downloads

| Platform | File |
| --- | --- |
| Windows 10/11 (x64) | `AntiVPN-Setup-{{VERSION}}.exe` |
| macOS 12+ Apple Silicon (M1 and later) | `AntiVPN-{{VERSION}}-mac-arm64.dmg` |
| macOS 12+ Intel | `AntiVPN-{{VERSION}}-mac-x64.dmg` |

The `.zip` files are the same macOS app without the disk image.

## Install on Windows

1. Run `AntiVPN-Setup-{{VERSION}}.exe` and allow administrator permission (needed for the full-system VPN and Kill Switch).
2. If SmartScreen warns you, click **More info → Run anyway** (the installer is not code-signed yet).

## Install on macOS

1. Pick the right file: Apple menu → **About This Mac**. "Apple M…" → `arm64`, "Intel" → `x64`.
2. Open the `.dmg` and drag **Anti VPN** into **Applications**.
3. The app is not notarized by Apple yet, so run this once in **Terminal**:
   ```bash
   xattr -cr "/Applications/Anti VPN.app"
   ```
   (Or open it once, then **System Settings → Privacy & Security → Open Anyway**.)
4. Open Anti VPN, add a config and connect. The first time, click **Grant permission** and enter your Mac password. This is needed once so the VPN can route all traffic.

---

## راهنمای نصب (فارسی)

**ویندوز:** فایل `AntiVPN-Setup-{{VERSION}}.exe` را اجرا کنید و دسترسی Administrator بدهید. اگر SmartScreen هشدار داد، **More info** و بعد **Run anyway** را بزنید.

**مک:**
۱. از منوی اپل ← **About This Mac** ببینید مک شما «Apple M…» است (فایل `arm64`) یا «Intel» (فایل `x64`).
۲. فایل `.dmg` را باز کنید و **Anti VPN** را داخل **Applications** بکشید.
۳. چون برنامه هنوز notarize نشده، یک بار در **Terminal** این را بزنید: `xattr -cr "/Applications/Anti VPN.app"`
۴. برنامه را باز کنید، کانفیگ اضافه کنید و وصل شوید. بار اول روی **Grant permission** بزنید و رمز مک را وارد کنید.
