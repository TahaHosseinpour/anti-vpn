"use client";

import type { DailyStat, SpeedTestResult } from "@shared/types";
import { ArrowDown, ArrowUp, Clock, Database, Gauge, Globe2, Loader2, Play, Timer, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { api } from "@/lib/api";
import { formatBytes, formatDuration, formatSpeed } from "@/lib/format";
import { cleanError, useVpn } from "@/lib/vpn-context";
import { Card, IconTile, SectionHeader } from "../bits";

const liveConfig = {
  down: { label: "Download", color: "var(--chart-1)" },
  up: { label: "Upload", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function StatsView() {
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-5">
      <LiveSpeed />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SpeedTest />
        <SessionCard />
      </div>
      <Weekly />
    </div>
  );
}

function LiveSpeed() {
  const { history, traffic, state } = useVpn();
  const connected = state.status === "connected";
  const data = useMemo(() => {
    const pts = history.slice(-90);
    const pad = Array.from({ length: Math.max(0, 90 - pts.length) }, (_, i) => ({ i, down: 0, up: 0 }));
    return [...pad, ...pts.map((p, i) => ({ i: pad.length + i, down: (p.down * 8) / 1e6, up: (p.up * 8) / 1e6 }))];
  }, [history]);
  const cur = traffic?.current;
  const tiles = [
    { label: "Download", icon: ArrowDown, v: connected ? cur?.down ?? 0 : 0, cls: "text-chart-1" },
    { label: "Upload", icon: ArrowUp, v: connected ? cur?.up ?? 0 : 0, cls: "text-chart-2" },
    { label: "Avg download", icon: TrendingUp, v: traffic?.avgDown ?? 0, cls: "text-chart-1" },
    { label: "Avg upload", icon: TrendingUp, v: traffic?.avgUp ?? 0, cls: "text-chart-2" },
    { label: "Peak download", icon: Gauge, v: traffic?.peakDown ?? 0, cls: "text-chart-1" },
  ];
  return (
    <section>
      <SectionHeader title="Live speed" />
      <Card className="p-5">
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map((t) => {
            const s = formatSpeed(t.v);
            return (
              <div key={t.label}>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <t.icon className={`size-3.5 ${t.cls}`} /> {t.label}
                </div>
                <div className="text-xl font-semibold tracking-tight tabular-nums">
                  {s.value} <span className="text-xs font-normal text-muted-foreground">{s.unit}</span>
                </div>
              </div>
            );
          })}
        </div>
        <ChartContainer config={liveConfig} className="aspect-auto h-[200px] w-full">
          <AreaChart data={data} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="fill-down" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-down)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--color-down)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="fill-up" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-up)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="var(--color-up)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="i" hide />
            <YAxis width={44} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v.toFixed(v < 10 ? 1 : 0)}`} unit="M" fontSize={11} />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel formatter={(v, name) => `${liveConfig[name as "down" | "up"]?.label}: ${Number(v).toFixed(2)} Mbps`} />}
            />
            <Area dataKey="up" type="monotone" stroke="var(--color-up)" fill="url(#fill-up)" strokeWidth={1.5} isAnimationActive={false} />
            <Area dataKey="down" type="monotone" stroke="var(--color-down)" fill="url(#fill-down)" strokeWidth={2} isAnimationActive={false} />
          </AreaChart>
        </ChartContainer>
        {!connected && <p className="mt-2 text-center text-xs text-muted-foreground">Connect to see live throughput.</p>}
      </Card>
    </section>
  );
}

function SpeedTest() {
  const { state } = useVpn();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SpeedTestResult | null>(null);
  const run = async () => {
    setRunning(true);
    try {
      setResult(await api().runSpeedTest());
    } catch (e) {
      toast.error("Speed test failed", { description: cleanError(e) });
    } finally {
      setRunning(false);
    }
  };
  return (
    <InfoCard
      icon={<Gauge className="size-4" strokeWidth={1.75} />}
      title="Speed test"
      action={
        <Button size="sm" variant="outline" className="rounded-full" disabled={running} onClick={() => void run()}>
          {running ? <Loader2 className="animate-spin" /> : <Play />} {running ? "Testing" : "Run"}
        </Button>
      }
      rows={[
        { icon: ArrowDown, label: "Download", value: result ? `${result.downloadMbps.toFixed(1)} Mbps` : "—" },
        { icon: Timer, label: "Latency", value: result ? `${result.latencyMs} ms` : "—" },
        { icon: Globe2, label: "Route", value: state.status === "connected" ? "Through VPN" : "Direct" },
        { icon: Clock, label: "Last run", value: result ? new Date(result.at).toLocaleTimeString() : "—" },
      ]}
    />
  );
}

function SessionCard() {
  const { traffic, state } = useVpn();
  return (
    <InfoCard
      icon={<Database className="size-4" strokeWidth={1.75} />}
      title="Current session"
      rows={[
        { icon: Timer, label: "Duration", value: formatDuration(traffic?.sessionSeconds ?? 0) },
        { icon: ArrowDown, label: "Downloaded", value: formatBytes(traffic?.sessionDown ?? 0) },
        { icon: ArrowUp, label: "Uploaded", value: formatBytes(traffic?.sessionUp ?? 0) },
        { icon: Globe2, label: "Public IP", value: state.publicIp?.ip ?? "—" },
      ]}
    />
  );
}

function InfoCard({
  icon,
  title,
  action,
  rows,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  rows: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }[];
}) {
  return (
    <Card className="flex flex-col p-5">
      <div className="mb-3 flex h-8 items-center gap-3">
        <IconTile className="size-8 rounded-lg">{icon}</IconTile>
        <div className="flex-1 text-sm font-medium">{title}</div>
        {action}
      </div>
      <div className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 py-2.5 text-sm">
            <r.icon className="size-3.5 text-muted-foreground" />
            <span className="flex-1 text-muted-foreground">{r.label}</span>
            <span className="selectable font-medium tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

const hoursConfig = { hours: { label: "Secured", color: "var(--chart-1)" }, rest: { label: "Not secured", color: "var(--border)" } } satisfies ChartConfig;
const dataConfig = { down: { label: "Download", color: "var(--chart-1)" }, up: { label: "Upload", color: "var(--chart-2)" } } satisfies ChartConfig;

function Weekly() {
  const { state } = useVpn();
  const [days, setDays] = useState<DailyStat[]>([]);
  useEffect(() => {
    const load = () => void api().getDailyStats(7).then(setDays);
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [state.status]);

  const rows = days.map((d) => {
    const date = new Date(d.date + "T00:00:00");
    const hours = d.seconds / 3600;
    return {
      day: date.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 1),
      full: date.toLocaleDateString("en-US", { weekday: "long" }),
      hours: +hours.toFixed(2),
      rest: +Math.max(0, 24 - hours).toFixed(2),
      down: d.down / 1e9,
      up: d.up / 1e9,
    };
  });
  const totalSecs = days.reduce((a, d) => a + d.seconds, 0);
  const avgHours = totalSecs / 3600 / Math.max(1, days.length);
  const totalDown = days.reduce((a, d) => a + d.down, 0);
  const totalUp = days.reduce((a, d) => a + d.up, 0);
  const avgData = (totalDown + totalUp) / 1e9 / Math.max(1, days.length);

  return (
    <section>
      <SectionHeader title="Last 7 days" />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <div className="text-sm font-medium">Secured by VPN</div>
          <div className="mb-3 text-xs text-muted-foreground">
            Daily average: <span className="font-medium text-foreground">{formatDuration(avgHours * 3600)}</span>
          </div>
          <ChartContainer config={hoursConfig} className="aspect-auto h-[170px] w-full">
            <BarChart data={rows} barSize={10}>
              <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis width={30} ticks={[0, 24]} domain={[0, 24]} tickFormatter={(v) => `${v}h`} tickLine={false} axisLine={false} fontSize={11} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent labelKey="full" formatter={(v, n) => `${hoursConfig[n as "hours"]?.label ?? n}: ${Number(v).toFixed(1)}h`} />} />
              <Bar dataKey="hours" stackId="a" fill="var(--color-hours)" radius={[0, 0, 4, 4]} />
              <Bar dataKey="rest" stackId="a" fill="var(--color-rest)" radius={[4, 4, 0, 0]} />
              {avgHours > 0 && <ReferenceLine y={avgHours} stroke="var(--chart-3)" strokeDasharray="4 4" label={{ value: "avg", position: "left", fontSize: 10, fill: "var(--chart-3)" }} />}
            </BarChart>
          </ChartContainer>
          <div className="mt-2 flex gap-2 text-xs">
            <Legend color="bg-chart-1" text={`${formatDuration(totalSecs)} secured`} />
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-sm font-medium">Data usage</div>
          <div className="mb-3 text-xs text-muted-foreground">
            Daily average: <span className="font-medium text-foreground">{avgData.toFixed(2)} GB</span>
          </div>
          <ChartContainer config={dataConfig} className="aspect-auto h-[170px] w-full">
            <BarChart data={rows} barSize={10}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis width={36} tickFormatter={(v: number) => `${v.toFixed(v < 1 ? 1 : 0)}G`} tickLine={false} axisLine={false} fontSize={11} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent labelKey="full" formatter={(v, n) => `${dataConfig[n as "down"]?.label}: ${formatBytes(Number(v) * 1e9)}`} />} />
              <Bar dataKey="down" stackId="d" fill="var(--color-down)" radius={[0, 0, 4, 4]} />
              <Bar dataKey="up" stackId="d" fill="var(--color-up)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
          <div className="mt-2 flex gap-2 text-xs">
            <Legend color="bg-chart-1" text={`${formatBytes(totalDown)} down`} />
            <Legend color="bg-chart-2" text={`${formatBytes(totalUp)} up`} />
          </div>
        </Card>
      </div>
    </section>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
      <span className={`size-2 rounded-full ${color}`} /> {text}
    </span>
  );
}
