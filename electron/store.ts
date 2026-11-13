// Tiny JSON-file persistence in the app's userData directory.

import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DailyStat, Profile, Settings, Subscription } from "../shared/types";

export const DEFAULT_SETTINGS: Settings = {
  killSwitch: { enabled: false, exceptions: [] },
  remoteDns: "1.1.1.1",
  tunStack: "mixed",
  mtu: 9000,
  ipv6: false,
  pingUrl: "https://www.youtube.com/generate_204",
  pingTimeout: 5000,
  connectOnLaunch: false,
  launchAtStartup: false,
  systemNotifications: true,
  autoReconnect: true,
  theme: "light",
  sortBy: "ping",
};

class JsonFile<T> {
  private timer: NodeJS.Timeout | null = null;
  constructor(
    private file: string,
    public data: T,
  ) {
    try {
      if (existsSync(file)) this.data = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      console.error("Failed to read", file, e);
    }
  }
  save(immediate = false) {
    if (this.timer) clearTimeout(this.timer);
    const write = () => {
      this.timer = null;
      const tmp = this.file + ".tmp";
      writeFileSync(tmp, JSON.stringify(this.data, null, 1));
      renameSync(tmp, this.file);
    };
    if (immediate) write();
    else this.timer = setTimeout(write, 300);
  }
}

export class Store {
  readonly dir: string;
  profiles: JsonFile<Profile[]>;
  subscriptions: JsonFile<Subscription[]>;
  settings: JsonFile<Settings>;
  stats: JsonFile<Record<string, DailyStat>>;

  constructor() {
    this.dir = join(app.getPath("userData"), "data");
    mkdirSync(this.dir, { recursive: true });
    this.profiles = new JsonFile(join(this.dir, "profiles.json"), []);
    this.subscriptions = new JsonFile(join(this.dir, "subscriptions.json"), []);
    this.settings = new JsonFile(join(this.dir, "settings.json"), DEFAULT_SETTINGS);
    // merge new default keys into older settings files
    this.settings.data = {
      ...DEFAULT_SETTINGS,
      ...this.settings.data,
      killSwitch: { ...DEFAULT_SETTINGS.killSwitch, ...this.settings.data.killSwitch },
    };
    this.stats = new JsonFile(join(this.dir, "stats.json"), {});
  }

  flush() {
    this.profiles.save(true);
    this.subscriptions.save(true);
    this.settings.save(true);
    this.stats.save(true);
  }
}

export function todayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
