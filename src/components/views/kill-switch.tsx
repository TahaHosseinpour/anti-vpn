"use client";

import { Plus, ShieldCheck, ShieldOff, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useVpn } from "@/lib/vpn-context";
import { Card, SectionHeader } from "../bits";

const PRESETS: { label: string; values: string[] }[] = [
  { label: ".ir sites", values: ["ir"] },
  { label: "Local network", values: ["192.168.0.0/16", "10.0.0.0/8"] },
];

function normalize(raw: string): string | null {
  let v = raw.trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^[a-z]+:\/\//, "").replace(/\/(?!\d+$).*$/, "").replace(/^\*?\./, "");
  if (/^[\d.]+(\/\d{1,2})?$/.test(v) || /^[0-9a-f:]+(\/\d{1,3})?$/.test(v) || /^[a-z0-9.-]+$/.test(v)) return v;
  return null;
}

export function KillSwitchView() {
  const { settings, updateSettings, state, confirm } = useVpn();
  const [input, setInput] = useState("");
  if (!settings) return null;
  const ks = settings.killSwitch;

  const add = (values: string[]) => {
    const next = [...ks.exceptions];
    const bad: string[] = [];
    for (const raw of values) {
      const v = normalize(raw);
      if (!v) bad.push(raw);
      else if (!next.includes(v)) next.push(v);
    }
    if (bad.length) toast.error(`Invalid: ${bad.join(", ")}`);
    if (next.length !== ks.exceptions.length) void updateSettings({ killSwitch: { ...ks, exceptions: next } });
  };
  const remove = (v: string) => void updateSettings({ killSwitch: { ...ks, exceptions: ks.exceptions.filter((x) => x !== v) } });

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-5">
      <Card className="flex items-center gap-4 p-5">
        <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", ks.enabled ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>
          {ks.enabled ? <ShieldCheck className="size-5" /> : <ShieldOff className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium">Kill Switch</div>
          <div className={cn("text-sm", state.blocking ? "text-destructive" : "text-muted-foreground")}>
            {state.blocking ? "VPN is down, internet is blocked" : "Blocks the internet if the VPN drops"}
          </div>
        </div>
        <Switch
          checked={ks.enabled}
          onCheckedChange={async (v) => {
            if (!v && state.status !== "disconnected") {
              const ok = await confirm({
                title: "Turn off Kill Switch?",
                message: "If the VPN drops, your real connection will be used and your traffic may be exposed.",
                confirmLabel: "Turn off",
                tone: "danger",
              });
              if (!ok) return;
            }
            void updateSettings({ killSwitch: { ...ks, enabled: v } });
          }}
          aria-label="Kill Switch"
        />
      </Card>

      <section>
        <SectionHeader title="Exceptions · always direct" />
        <Card className="p-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add(input.split(/[\s,]+/));
              setInput("");
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Domain or IP, e.g. bank.ir"
              className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/30"
            />
            <Button type="submit" className="h-9 rounded-lg" disabled={!input.trim()}>
              <Plus /> Add
            </Button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            {PRESETS.filter((p) => !p.values.every((v) => ks.exceptions.includes(v))).map((p) => (
              <button
                key={p.label}
                onClick={() => add(p.values)}
                className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="size-3" /> {p.label}
              </button>
            ))}
            {ks.exceptions.map((v) => (
              <span key={v} className="inline-flex h-7 items-center gap-1 rounded-full bg-muted pr-1 pl-3 text-xs font-medium">
                {v.includes(".") || v.includes(":") ? v : `.${v}`}
                <button onClick={() => remove(v)} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground" aria-label={`Remove ${v}`}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}
