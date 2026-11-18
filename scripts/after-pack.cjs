/* eslint-disable @typescript-eslint/no-require-imports */
// electron-builder afterPack hook.
// macOS builds are not signed with a Developer ID, so give the bundle an ad-hoc signature:
// Apple Silicon refuses to run code with no signature at all.
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== "darwin") return;
  const app = join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing ${app}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
};
