"use client";

import { COUNTRY_CENTROIDS } from "@shared/countries";
import { geoMercator, geoPath } from "d3-geo";
import { useEffect, useRef } from "react";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import countries from "world-atlas/countries-50m.json";
import { cn } from "@/lib/utils";

// Simple vector map (land + country borders). World coordinates: Mercator at a fixed scale. The canvas shows a window of VIEW_W
// world units, panned so the target sits at 68% width, so the zoom level is constant.
const SCALE = 300;
const VIEW_W = 420; // visible width in world units (smaller = more zoomed in)
const WORLD_W = Math.round(2 * Math.PI * SCALE);
const projection = geoMercator().scale(SCALE).translate([WORLD_W / 2, Math.PI * SCALE]);

const topo = countries as unknown as Topology<{ countries: GeometryCollection }>;

interface MapData {
  land: Path2D;
  borders: Path2D;
}
let cache: MapData | null = null;

/** Builds the land shapes and the country border mesh once. */
function buildMap(): MapData {
  if (cache) return cache;
  const path = geoPath(projection);
  cache = {
    land: new Path2D(path(feature(topo, topo.objects.countries)) ?? ""),
    borders: new Path2D(path(mesh(topo, topo.objects.countries, (a, b) => a !== b)) ?? ""),
  };
  return cache;
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function WorldMap({
  country,
  status,
  className,
}: {
  country?: string;
  status: "connected" | "connecting" | "disconnected" | "blocked";
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const center = useRef<[number, number] | null>(null);
  const anim = useRef(0);
  const target = (country && COUNTRY_CENTROIDS[country]) || [48, 14];
  const [tx, ty] = projection([target[1], target[0]]) ?? [0, 0];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const map = buildMap();

    const draw = (cx: number, cy: number) => {
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (!W || !H) return;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      const ctx = canvas.getContext("2d")!;
      const s = W / VIEW_W; // px per world unit
      const ox = W * (W < 640 ? 0.8 : 0.68) - cx * s;
      const oy = H * 0.5 - cy * s;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = cssVar("--map-sea");
      ctx.fillRect(0, 0, W, H);
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
      ctx.fillStyle = cssVar("--map-land");
      ctx.fill(map.land);
      ctx.lineJoin = "round";
      ctx.lineWidth = 0.8 / s;
      ctx.strokeStyle = cssVar("--map-border");
      ctx.stroke(map.borders);
    };

    // Animate the pan from the previous centre to the new one.
    const from = center.current ?? [tx, ty];
    const start = performance.now();
    const dur = center.current ? 900 : 0;
    cancelAnimationFrame(anim.current);
    const step = (now: number) => {
      const t = dur ? Math.min(1, (now - start) / dur) : 1;
      const e = 1 - Math.pow(1 - t, 3);
      const cx = from[0] + (tx - from[0]) * e;
      const cy = from[1] + (ty - from[1]) * e;
      center.current = [cx, cy];
      draw(cx, cy);
      if (t < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);

    // Redraw on resize and on theme change.
    const redraw = () => center.current && draw(center.current[0], center.current[1]);
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    const mo = new MutationObserver(redraw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      cancelAnimationFrame(anim.current);
      ro.disconnect();
      mo.disconnect();
    };
  }, [tx, ty]);

  const pin = status === "connected" ? "bg-success" : status === "blocked" ? "bg-destructive" : "bg-foreground";
  return (
    <div className={cn("overflow-hidden", className)} aria-hidden>
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
      {country && (
        <span className="absolute top-1/2 left-[80%] flex sm:left-[68%] size-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center">
          {status !== "disconnected" && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", pin)} />}
          <span className={cn("relative size-3 rounded-full ring-2 ring-background", pin)} />
        </span>
      )}
    </div>
  );
}
