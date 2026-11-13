"use client";

import { Globe2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** Minimal round flag (circle-flags, copied to /public/flags at install time). */
export function Flag({ code, className }: { code?: string; protocol?: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  const c = code?.toLowerCase();
  return (
    <span className={cn("relative inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted", className)}>
      {c && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/flags/${c}.svg`} alt={code} className="size-full" draggable={false} onError={() => setBroken(true)} />
      ) : (
        <Globe2 className="size-1/2 text-muted-foreground" strokeWidth={1.75} />
      )}
    </span>
  );
}
