"use client";

import type { LogLine, Settings } from "@shared/types";
import { CheckCircle2, Cpu, ScrollText, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { cleanError, useVpn } from "@/lib/vpn-context";
import { toast } from "sonner";
import { Card, SectionHeader } from "../bits";

const DNS_PRESETS = [
  { label: "Cloudflare", value: "1.1.1.1" },
  { label: "Google", value: "8.8.8.8" },
  { label: "Quad9", value: "9.9.9.9" },
  { label: "Cloudflare DoH", value: "https://1.1.1.1/dns-query" },
];

export function SettingsView() {
  const { settings, updateSettings, system } = useVpn();
  const [logsOpen, setLogsOpen] = useState(false);
  if (!settings) return null;
  const set = (p: Partial<Settings>) => void updateSettings(p);

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-5">
      <section>
        <SectionHeader title="General" />
        <Card className="divide-y divide-border/70 px-5">
          <Row title="Appearance" desc="Light, dark or follow Windows.">
            <Segmented value={settings.theme} options={["light", "dark", "system"]} onChange={(v) => set({ theme: v as Settings["theme"] })} />
          </Row>
          <Row title="Launch at startup" desc="Open Anti VPN automatically when Windows starts.">
            <Switch
              checked={settings.launchAtStartup}
              onCheckedChange={async (v) => {
                try {
                  await updateSettings({ launchAtStartup: v });
                } catch (e) {
                  toast.error(cleanError(e));
                  await updateSettings({});
                }
              }}
            />
          </Row>
          <Row title="System notifications" desc="Alert me in Windows when the VPN connects, drops or reconnects while Anti VPN is in the background.">
            <Switch checked={settings.systemNotifications} onCheckedChange={(v) => set({ systemNotifications: v })} />
          </Row>
          <Row title="Connect on launch" desc="Reconnect to the last used config when Anti VPN starts.">
            <Switch checked={settings.connectOnLaunch} onCheckedChange={(v) => set({ connectOnLaunch: v })} />
          </Row>
          <Row title="Auto-reconnect" desc="When the Kill Switch is off, try once more before giving up on a dropped connection.">
            <Switch checked={settings.autoReconnect} onCheckedChange={(v) => set({ autoReconnect: v })} />
          </Row>
        </Card>
      </section>

      <section>
        <SectionHeader title="Connection" />
        <Card className="divide-y divide-border/70 px-5">
          <Row title="DNS server" desc="Resolved through the VPN to prevent DNS leaks.">
            <div className="flex flex-col items-end gap-2">
              <TextInput value={settings.remoteDns} onCommit={(v) => set({ remoteDns: v || "1.1.1.1" })} className="w-56" />
              <div className="flex gap-1">
                {DNS_PRESETS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => set({ remoteDns: d.value })}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted",
                      settings.remoteDns === d.value && "bg-accent text-accent-foreground",
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </Row>
          <Row title="TUN stack" desc="“mixed” works best for most networks. Try “gvisor” if some apps misbehave.">
            <Segmented value={settings.tunStack} options={["mixed", "system", "gvisor"]} onChange={(v) => set({ tunStack: v as Settings["tunStack"] })} />
          </Row>
          <Row title="IPv6" desc="Route IPv6 through the VPN. Leave off unless your configs support IPv6.">
            <Switch checked={settings.ipv6} onCheckedChange={(v) => set({ ipv6: v })} />
          </Row>
          <Row title="TUN MTU" desc="Default 9000.">
            <TextInput value={String(settings.mtu)} onCommit={(v) => set({ mtu: Math.min(9000, Math.max(1280, Number(v) || 9000)) })} className="w-24 text-right" />
          </Row>
        </Card>
      </section>

      <section>
        <SectionHeader title="Ping" />
        <Card className="divide-y divide-border/70 px-5">
          <Row title="Test URL" desc="Ping measures a real request to this URL through each config.">
            <TextInput value={settings.pingUrl} onCommit={(v) => set({ pingUrl: v || "https://www.youtube.com/generate_204" })} className="w-full sm:w-72" />
          </Row>
          <Row title="Timeout" desc="Configs slower than this count as timed out.">
            <div className="flex items-center gap-1.5 text-sm">
              <TextInput value={String(settings.pingTimeout)} onCommit={(v) => set({ pingTimeout: Math.min(20000, Math.max(1000, Number(v) || 5000)) })} className="w-24 text-right" />
              <span className="text-muted-foreground">ms</span>
            </div>
          </Row>
        </Card>
      </section>

      <section>
        <SectionHeader title="System" />
        <Card className="divide-y divide-border/70 px-5">
          <Row title="Administrator" desc="Required for full-system (TUN) mode and the Kill Switch.">
            <StatusPill ok={!!system?.isAdmin} okText="Running as admin" badText="Not elevated" />
          </Row>
          <Row title="VPN engine" desc={system?.core.path ?? ""}>
            <StatusPill ok={!!system?.core.found} okText={`sing-box ${system?.core.version ?? ""}`} badText="Missing" />
          </Row>
          <Row title="Logs" desc="Engine output, useful when a config does not connect.">
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setLogsOpen(true)}>
              <ScrollText /> View logs
            </Button>
          </Row>
        </Card>
        <p className="mt-3 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <Cpu className="size-3.5" /> Anti VPN {system?.appVersion} · powered by sing-box
        </p>
      </section>
      <LogsDialog open={logsOpen} onOpenChange={setLogsOpen} />
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {desc && <div className="text-xs text-muted-foreground">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function Segmented({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-full bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium capitalize text-muted-foreground transition",
            value === o && "bg-card text-foreground shadow-sm",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function TextInput({ value, onCommit, className }: { value: string; onCommit: (v: string) => void; className?: string }) {
  const [v, setV] = useState(value);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setV(value);
  }
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={cn(
        "h-8 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary/50 focus:ring-3 focus:ring-primary/15",
        className,
      )}
    />
  );
}

function StatusPill({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", ok ? "text-success" : "text-destructive")}>
      {ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
      {ok ? okText : badText}
    </span>
  );
}

function LogsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    void api().getLogs().then((l) => setLines([...l]));
    return api().onLog((l) => setLines((prev) => [...prev.slice(-599), l]));
  }, [open]);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [lines]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Logs</DialogTitle>
        </DialogHeader>
        <div className="selectable h-[420px] overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-[11px] leading-relaxed">
          {lines.map((l, i) => (
            <div key={i} className={cn(l.level === "error" && "text-destructive", l.level === "warn" && "text-warning")}>
              <span className="text-muted-foreground">{new Date(l.t).toLocaleTimeString()} </span>
              {l.msg}
            </div>
          ))}
          <div ref={end} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
