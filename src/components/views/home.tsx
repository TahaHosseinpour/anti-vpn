"use client";

import { countryName } from "@shared/countries";
import { AlertTriangle, Check, ChevronRight, Clock, Gauge, Loader2, MoreHorizontal, RotateCcw, ShieldAlert, ShieldCheck, WifiOff, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { formatClock, speedText } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useVpn } from "@/lib/vpn-context";
import { Card, IconTile, PingBadge, SectionHeader } from "../bits";
import { Flag } from "../flag";
import { WorldMap } from "../world-map";

export function HomeView() {
  return (
    <div className="flex min-h-0 flex-col gap-5 p-4 sm:p-5 lg:h-full [&>section]:shrink-0">
      <Hero />
      <Banner />
      <Recents />
      <Statistics />
    </div>
  );
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Hero() {
  const { state, selectedProfile: p, toggle, setView, pingAll, disconnect } = useVpn();
  const now = useNow();
  const country = state.publicIp?.countryCode ?? p?.country;
  const connected = state.status === "connected";
  const connecting = state.status === "connecting";
  const reconnecting = state.status === "reconnecting";
  const working = connecting || reconnecting || state.status === "disconnecting";

  return (
    <Card className="relative h-[240px] shrink-0 overflow-hidden lg:h-auto lg:min-h-[230px] lg:flex-1 lg:shrink">
      <WorldMap
        country={country}
        status={state.blocking ? "blocked" : connected ? "connected" : state.status === "disconnected" ? "disconnected" : "connecting"}
        className="absolute inset-0 size-full"
      />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[70%] sm:w-[55%]" style={{ background: "linear-gradient(to right, var(--map-bg) 45%, transparent)" }} />
      {/* indeterminate progress bar while working */}
      {working && (
        <div className="absolute inset-x-0 top-0 h-[3px] overflow-hidden bg-blue/10">
          <div className={cn("h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite]", state.blocking ? "bg-destructive" : "bg-blue")} />
        </div>
      )}
      <div className="relative flex h-full flex-col justify-center gap-3 px-5 py-4 sm:px-7">
        <div className="flex items-center gap-3">
          <span className="relative inline-flex size-10 shrink-0">
            <Flag code={country} className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[22px] leading-tight font-semibold tracking-tight">
              {p ? (country ? countryName(country) : p.name) : "No configs yet"}
            </h1>
            <StatusLine now={now} />
          </div>
        </div>

        {connecting && <ConnectSteps phase={state.phase} />}
        {reconnecting && <ReconnectPanel now={now} />}

        <div className="flex items-center gap-2">
          {reconnecting ? (
            <>
              <Button onClick={() => void api().reconnectNow()} className="h-10 rounded-full px-5 text-sm">
                <RotateCcw /> Reconnect now
              </Button>
              <Button variant="outline" onClick={() => void disconnect()} className="h-10 rounded-full px-5 text-sm">
                Cancel
              </Button>
            </>
          ) : (
            <Button
              disabled={state.status === "disconnecting" || (!p && state.status === "disconnected")}
              onClick={() => void toggle()}
              variant={state.status === "disconnected" ? "default" : "outline"}
              className={cn(
                "h-10 min-w-[150px] rounded-full px-5 text-sm transition-all",
                connected && "border-transparent bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive dark:hover:bg-destructive/90",
              )}
            >
              {state.status === "disconnected" ? (
                "Quick connect"
              ) : connected ? (
                "Disconnect"
              ) : state.status === "disconnecting" ? (
                <>
                  <Loader2 className="animate-spin" /> Disconnecting
                </>
              ) : (
                "Cancel"
              )}
            </Button>
          )}
          {!working && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="icon" className="size-10 rounded-full" aria-label="More">
                    <MoreHorizontal />
                  </Button>
                }
              />
              <DropdownMenuContent align="start" className="min-w-48">
                <DropdownMenuItem onClick={() => setView("configs")}>Choose a config</DropdownMenuItem>
                <DropdownMenuItem onClick={() => pingAll()}>
                  <Zap /> Ping all
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {p && !working && <p className="truncate text-xs text-muted-foreground">{p.name} · {p.detail}</p>}
      </div>
    </Card>
  );
}

function StatusLine({ now }: { now: number }) {
  const { state } = useVpn();
  const s = state.status;
  if (state.blocking) return <p className="text-sm font-medium text-destructive">Blocked by Kill Switch</p>;
  if (s === "connected")
    return (
      <p className="text-sm font-medium text-success">
        Secured
        {state.since && <span className="font-normal text-muted-foreground tabular-nums"> · {formatClock((now - state.since) / 1000)}</span>}
      </p>
    );
  if (s === "connecting") return <p className="text-sm font-medium text-blue">Connecting…</p>;
  if (s === "reconnecting") return <p className="text-sm font-medium text-warning">Connection lost</p>;
  if (s === "disconnecting") return <p className="text-sm font-medium text-muted-foreground">Disconnecting…</p>;
  return <p className="text-sm font-medium text-muted-foreground">Not connected</p>;
}

const STEPS: { id: "starting" | "connecting" | "verifying"; label: string }[] = [
  { id: "starting", label: "Starting engine" },
  { id: "connecting", label: "Connecting to server" },
  { id: "verifying", label: "Verifying connection" },
];

function ConnectSteps({ phase }: { phase?: "starting" | "connecting" | "verifying" }) {
  const current = Math.max(0, STEPS.findIndex((x) => x.id === phase));
  return (
    <ol className="flex animate-in flex-wrap items-center gap-x-3 gap-y-1 duration-300 fade-in">
      {STEPS.map((st, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={st.id} className={cn("flex items-center gap-1.5 text-xs", done ? "text-foreground" : active ? "font-medium text-blue" : "text-muted-foreground/60")}>
            {done ? (
              <Check className="size-3.5 animate-in text-success duration-300 zoom-in" />
            ) : active ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <span className="size-1.5 rounded-full bg-current" />
            )}
            {st.label}
            {i < STEPS.length - 1 && <span className="ml-1.5 h-px w-4 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}

function ReconnectPanel({ now }: { now: number }) {
  const { state } = useVpn();
  const r = state.reconnect;
  const trying = state.phase === "connecting";
  const secs = r ? Math.max(0, Math.ceil((r.nextAt - now) / 1000)) : 0;
  return (
    <div className="max-w-md animate-in rounded-xl border border-warning/30 bg-warning/8 px-3 py-2 text-xs duration-300 fade-in slide-in-from-left-1">
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        {trying || secs === 0 ? <Loader2 className="size-3.5 animate-spin text-warning" /> : <WifiOff className="size-3.5 text-warning" />}
        {trying || secs === 0 ? "Reconnecting…" : `Reconnecting in ${secs}s`}
        {r && <span className="font-normal text-muted-foreground">· attempt {r.attempt}{r.max ? ` of ${r.max}` : ""}</span>}
      </div>
      {state.error && <div className="mt-0.5 text-muted-foreground">{state.error}</div>}
    </div>
  );
}

/** Only shown when something needs attention. */
function Banner() {
  const { system, online, setDialog } = useVpn();
  let b: { title: string; text: string; danger?: boolean; icon?: React.ReactNode; onClick?: () => void } | null = null;
  if (system && !system.core.found) b = { title: "VPN engine not found", text: "Reinstall Anti VPN to restore the connection engine.", danger: true, onClick: () => setDialog({ kind: "core" }) };
  else if (system && !system.isAdmin)
    b = { title: "Administrator permission needed", text: "Click to restart Anti VPN as administrator.", onClick: () => setDialog({ kind: "admin" }) };
  else if (!online) b = { title: "No internet connection", text: "Check your network. Anti VPN will connect once you're back online.", icon: <WifiOff className="size-4 text-warning" /> };
  if (!b) return null;
  return (
    <Card
      className={cn("flex shrink-0 animate-in items-center gap-3 px-4 py-3 duration-300 fade-in slide-in-from-top-1", b.onClick && "cursor-pointer hover:bg-muted/50")}
      onClick={b.onClick}
    >
      <IconTile className={b.danger ? "bg-destructive/10" : "bg-warning/12"}>
        {b.icon ?? (b.danger ? <ShieldAlert className="size-4 text-destructive" /> : <AlertTriangle className="size-4 text-warning" />)}
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{b.title}</div>
        <div className="text-xs text-muted-foreground">{b.text}</div>
      </div>
      {b.onClick && <ChevronRight className="size-4 text-muted-foreground" />}
    </Card>
  );
}

function Recents() {
  const { profiles, connect, state, setView, isPinging } = useVpn();
  const recent = [...profiles].filter((p) => p.lastUsedAt).sort((a, b) => b.lastUsedAt! - a.lastUsedAt!);
  const fastest = [...profiles].filter((p) => (p.ping ?? -1) > 0).sort((a, b) => a.ping! - b.ping!);
  const list = [...recent, ...fastest, ...profiles].filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i).slice(0, 5);
  if (!list.length) return null;
  return (
    <section>
      <SectionHeader
        title="Recents"
        action={
          <button onClick={() => setView("configs")} className="flex items-center gap-0.5 text-[13px] font-medium">
            All configs <ChevronRight className="size-4" />
          </button>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {list.map((p, i) => {
          const active = state.profileId === p.id && state.status !== "disconnected";
          return (
            <button
              key={p.id}
              onClick={() => void connect(p.id)}
              className={cn(
                "flex flex-col items-start gap-2.5 rounded-2xl border border-border bg-card p-3.5 text-left transition-all hover:-translate-y-0.5 hover:bg-muted/40 active:scale-[0.98]",
                active && "border-foreground/40",
                i === 3 && "sm:hidden lg:flex",
                i === 4 && "hidden lg:flex",
              )}
            >
              <Flag code={p.country} className="size-6" />
              <div className="w-full min-w-0">
                <div className="truncate text-[13px] font-medium">{p.name}</div>
                <div className="truncate text-xs text-muted-foreground">{active ? "Connected" : p.detail.split(" · ")[0]}</div>
              </div>
              <PingBadge key={`${p.id}-${p.pingAt ?? 0}`} ms={p.ping} loading={isPinging(p.id)} className="min-w-0 justify-start" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Statistics() {
  const { traffic, state, settings, setView } = useVpn();
  const connected = state.status === "connected";
  return (
    <section>
      <SectionHeader
        title="Statistics"
        action={
          <button onClick={() => setView("stats")} className="flex items-center gap-0.5 text-[13px] font-medium">
            Details <ChevronRight className="size-4" />
          </button>
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon={<Clock className="size-4" strokeWidth={1.75} />} title="Connection" value={formatClock(traffic?.sessionSeconds ?? 0)} />
        <StatCard
          icon={<Gauge className="size-4" strokeWidth={1.75} />}
          title="Speed"
          sub={`avg ${speedText(traffic?.avgDown ?? 0)}`}
          value={speedText(connected ? traffic?.current.down ?? 0 : 0)}
        />
        <StatCard
          icon={<ShieldCheck className="size-4" strokeWidth={1.75} />}
          title="Kill Switch"
          onClick={() => setView("killswitch")}
          value={
            <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium", settings?.killSwitch.enabled ? "bg-success/12 text-success" : "bg-muted text-muted-foreground")}>
              {settings?.killSwitch.enabled ? "On" : "Off"}
            </span>
          }
        />
      </div>
    </section>
  );
}

function StatCard({ icon, title, sub, value, onClick }: { icon: React.ReactNode; title: string; sub?: string; value: React.ReactNode; onClick?: () => void }) {
  return (
    <Card className={cn("flex items-center gap-3 px-4 py-3.5", onClick && "cursor-pointer hover:bg-muted/50")} onClick={onClick}>
      <IconTile>{icon}</IconTile>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
      </div>
      <div className={cn("text-sm font-semibold tabular-nums", typeof value === "string" && "text-blue")}>{value}</div>
    </Card>
  );
}
