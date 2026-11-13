// Copies the minimal round flags (circle-flags, MIT) into public/flags.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const src = join(process.cwd(), "node_modules", "circle-flags", "flags");
const dst = join(process.cwd(), "public", "flags");
if (existsSync(src)) {
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log("flags copied to public/flags");
}
