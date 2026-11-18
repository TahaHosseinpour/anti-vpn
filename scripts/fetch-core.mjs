// Downloads the sing-box core into resources/bin.
// Defaults to the current OS/arch. Override with: --platform windows|darwin --arch amd64|arm64
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const VERSION = process.env.SINGBOX_VERSION ?? "1.14.4";
const platform = arg("platform") ?? (process.platform === "win32" ? "windows" : process.platform);
const arch = arg("arch") ?? (process.arch === "arm64" ? "arm64" : "amd64");
const isWin = platform === "windows";
const exe = isWin ? "sing-box.exe" : "sing-box";

const binDir = join(process.cwd(), "resources", "bin");
const target = join(binDir, exe);
const force = process.argv.includes("--force");

if (existsSync(target) && !force) {
  console.log(`sing-box already present at ${target} (use --force to re-download)`);
  process.exit(0);
}
// Never ship a core for the wrong OS/arch: start from an empty folder.
rmSync(binDir, { recursive: true, force: true });
mkdirSync(binDir, { recursive: true });

const name = `sing-box-${VERSION}-${platform}-${arch}`;
const ext = isWin ? "zip" : "tar.gz";
const url = `https://github.com/SagerNet/sing-box/releases/download/v${VERSION}/${name}.${ext}`;
console.log(`Downloading ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
const tmp = join(tmpdir(), `antivpn-${Date.now()}`);
mkdirSync(tmp, { recursive: true });
const archive = join(tmp, `sb.${ext}`);
writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
// On Windows use the system bsdtar (GNU tar from Git Bash treats "C:" as a remote host).
const winTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
const tar = process.platform === "win32" && existsSync(winTar) ? winTar : "tar";
execFileSync(tar, ["-xf", archive, "-C", tmp]);
const src = join(tmp, name);
if (!existsSync(join(src, exe))) throw new Error(`${exe} not found in archive (got: ${readdirSync(src).join(", ")})`);
copyFileSync(join(src, exe), target);
if (!isWin) chmodSync(target, 0o755);
copyFileSync(join(src, "LICENSE"), join(binDir, "sing-box-LICENSE"));
rmSync(tmp, { recursive: true, force: true });
console.log(`sing-box ${VERSION} (${platform}-${arch}) installed to ${target}`);
