"use client";

import type { TrafficSample } from "@shared/types";
import { Loader2 } from "lucide-react";
import { pingTone } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PingBadge({ ms, loading, className }: { ms?: number; loading?: boolean; className?: string }) {
  const tone = pingTone(ms);
  if (loading) {
    return (
      <span className={cn("inline-flex min-w-[64px] items-center justify-end gap-1.5 text-xs font-medium text-muted-foreground", className)}>
        <Loader2 className="size-3.5 animate-spin text-blue" />
        <span className="skeleton h-3 w-9 rounded-full" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex min-w-[64px] animate-in items-center justify-end gap-1.5 text-xs font-medium tabular-nums duration-300 fade-in zoom-in-95",
        tone === "good" && "text-success",
        tone === "ok" && "text-warning",
        tone === "bad" && "text-destructive",
        tone === "fail" && "text-destructive/80",
        tone === "none" && "text-muted-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          tone === "good" && "bg-success",
          tone === "ok" && "bg-warning",
          (tone === "bad" || tone === "fail") && "bg-destructive",
          tone === "none" && "bg-muted-foreground/40",
        )}
      />
      {ms === undefined ? "—" : ms < 0 ? "Timeout" : `${ms} ms`}
    </span>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between px-1">
      <h2 className="text-[13px] font-medium text-muted-foreground">{title}</h2>
      {action}
    </div>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-border bg-card", className)} {...props} />;
}

export function IconTile({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted", className)}>
      {children}
    </span>
  );
}

/** Tiny SVG area sparkline for download speed. */
export function Sparkline({ data, className, height = 48 }: { data: TrafficSample[]; className?: string; height?: number }) {
  const W = 300;
  const pts = data.slice(-60);
  const max = Math.max(1, ...pts.map((p) => Math.max(p.down, p.up)));
  const xy = (v: number, i: number) => [(i / Math.max(1, 59)) * W, height - (v / max) * (height - 4) - 2] as const;
  const line = (key: "down" | "up") => pts.map((p, i) => xy(p[key], i + (60 - pts.length)).join(",")).join(" ");
  const offset = 60 - pts.length;
  const area = pts.length
    ? `M${xy(0, offset)[0]},${height} L${line("down").replace(/ /g, " L")} L${xy(0, 59)[0]},${height} Z`
    : "";
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className={cn("w-full", className)} style={{ height }}>
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--chart-1)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--chart-1)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {pts.length > 1 && (
        <>
          <path d={area} fill="url(#spark-fill)" />
          <polyline points={line("down")} fill="none" stroke="var(--chart-1)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
          <polyline points={line("up")} fill="none" stroke="var(--chart-2)" strokeWidth="1.4" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  );
}
