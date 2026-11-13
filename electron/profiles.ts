// Profile & subscription management on top of the store.

import { randomUUID } from "node:crypto";
import type { ImportOptions, ImportResult, Profile, SshForm, Subscription } from "../shared/types";
import { parseAny, ParsedProfile, profileFromSshForm } from "./parsers";
import { Store } from "./store";

export class ProfileService {
  constructor(
    private store: Store,
    private onChange: () => void,
  ) {}

  list(): Profile[] {
    return this.store.profiles.data;
  }

  private add(parsed: ParsedProfile[], subscriptionId?: string): Profile[] {
    const existing = new Set(this.store.profiles.data.map((p) => this.fingerprint(p)));
    const added: Profile[] = [];
    for (const pp of parsed) {
      const p: Profile = { ...pp, id: randomUUID(), createdAt: Date.now(), subscriptionId };
      const fp = this.fingerprint(p);
      if (existing.has(fp)) continue; // skip exact duplicates
      existing.add(fp);
      added.push(p);
    }
    this.store.profiles.data.push(...added);
    this.store.profiles.save();
    this.onChange();
    return added;
  }

  private fingerprint(p: Pick<Profile, "config" | "subscriptionId">) {
    return JSON.stringify(p.config) + "|" + (p.subscriptionId ?? "");
  }

  importText(text: string, opts?: ImportOptions, fileName?: string): ImportResult {
    const r = parseAny(text, opts, fileName);
    return { added: this.add(r.profiles), errors: r.errors };
  }

  addSsh(form: SshForm): ImportResult {
    try {
      return { added: this.add([profileFromSshForm(form)]), errors: [] };
    } catch (e) {
      return { added: [], errors: [{ input: form.host, reason: (e as Error).message }] };
    }
  }

  update(id: string, patch: Partial<Pick<Profile, "name" | "config" | "country" | "favorite">>): Profile {
    const p = this.store.profiles.data.find((x) => x.id === id);
    if (!p) throw new Error("Config not found");
    if (patch.config) {
      p.raw = undefined; // edited by hand – the original link no longer matches
      p.ping = undefined;
    }
    Object.assign(p, patch);
    this.store.profiles.save();
    this.onChange();
    return p;
  }

  remove(ids: string[]) {
    const set = new Set(ids);
    this.store.profiles.data = this.store.profiles.data.filter((p) => !set.has(p.id));
    this.store.profiles.save();
    this.onChange();
  }

  setPing(id: string, ms: number) {
    const p = this.store.profiles.data.find((x) => x.id === id);
    if (!p) return;
    p.ping = ms;
    p.pingAt = Date.now();
    this.store.profiles.save();
  }

  // ---------- subscriptions ----------

  listSubscriptions(): Subscription[] {
    return this.store.subscriptions.data;
  }

  async addSubscription(url: string, name?: string): Promise<ImportResult> {
    const u = new URL(url.trim());
    const sub: Subscription = { id: randomUUID(), url: u.toString(), name: name?.trim() || u.hostname };
    this.store.subscriptions.data.push(sub);
    this.store.subscriptions.save();
    return this.refreshSubscription(sub.id);
  }

  async refreshSubscription(id: string): Promise<ImportResult> {
    const sub = this.store.subscriptions.data.find((s) => s.id === id);
    if (!sub) throw new Error("Subscription not found");
    let body: string;
    try {
      const res = await fetch(sub.url, {
        headers: { "User-Agent": "v2rayN/7.0 sing-box" },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = await res.text();
    } catch (e) {
      sub.error = `Download failed: ${(e as Error).message}`;
      this.store.subscriptions.save();
      return { added: [], errors: [{ input: sub.url, reason: sub.error }] };
    }
    const r = parseAny(body);
    // Replace the old profiles of this subscription, keeping ping/country of unchanged ones.
    const old = this.store.profiles.data.filter((p) => p.subscriptionId === id);
    const oldByFp = new Map(old.map((p) => [JSON.stringify(p.config), p]));
    this.store.profiles.data = this.store.profiles.data.filter((p) => p.subscriptionId !== id);
    const kept: Profile[] = [];
    const fresh: ParsedProfile[] = [];
    for (const pp of r.profiles) {
      const prev = oldByFp.get(JSON.stringify(pp.config));
      if (prev) kept.push({ ...prev, name: pp.name });
      else fresh.push(pp);
    }
    this.store.profiles.data.push(...kept);
    const added = this.add(fresh, id);
    sub.updatedAt = Date.now();
    sub.error = r.profiles.length ? undefined : r.errors[0]?.reason ?? "Subscription is empty";
    this.store.subscriptions.save();
    this.onChange();
    return { added: [...kept, ...added], errors: r.errors };
  }

  removeSubscription(id: string) {
    this.store.subscriptions.data = this.store.subscriptions.data.filter((s) => s.id !== id);
    this.store.profiles.data = this.store.profiles.data.filter((p) => p.subscriptionId !== id);
    this.store.subscriptions.save();
    this.store.profiles.save();
    this.onChange();
  }
}
