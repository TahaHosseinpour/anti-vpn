// Downloads the sing-box core into resources/bin (Windows x64).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VERSION = process.env.SINGBOX_VERSION ?? "1.14.4";
const binDir = join(process.cwd(), "resources", "bin");
const target = join(binDir, "sing-box.exe");

if (existsSync(target) && !process.argv.includes("--force")) {
  console.log(`sing-box already present at ${target} (use --force to re-download)`);
  process.exit(0);
}
mkdirSync(binDir, { recursive: true });
const name = `sing-box-${VERSION}-windows-amd64`;
const url = `https://github.com/SagerNet/sing-box/releases/download/v${VERSION}/${name}.zip`;
console.log(`Downloading ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
const tmp = join(tmpdir(), `antivpn-${Date.now()}`);
mkdirSync(tmp, { recursive: true });
const zip = join(tmp, "sb.zip");
writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
// Use Windows' bsdtar (GNU tar from Git Bash treats "C:" as a remote host).
const winTar = join(process.env.SystemRoot ?? "C:\Windows", "System32", "tar.exe");
execFileSync(existsSync(winTar) ? winTar : "tar", ["-xf", zip, "-C", tmp]);
copyFileSync(join(tmp, name, "sing-box.exe"), target);
copyFileSync(join(tmp, name, "LICENSE"), join(binDir, "sing-box-LICENSE"));
rmSync(tmp, { recursive: true, force: true });
console.log(`sing-box ${VERSION} installed to ${target}`);
