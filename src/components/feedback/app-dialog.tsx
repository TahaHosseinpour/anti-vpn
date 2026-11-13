"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Check, ChevronDown, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export type Tone = "danger" | "warning" | "info" | "success" | "neutral";

const TONE: Record<Tone, string> = {
  danger: "bg-destructive/10 text-destructive",
  warning: "bg-warning/12 text-warning",
  info: "bg-blue/10 text-blue",
  success: "bg-success/12 text-success",
  neutral: "bg-muted text-foreground",
};

/** The single designed dialog used for every alert, confirmation and error in the app. */
export function AppDialog({
  open,
  onOpenChange,
  tone = "neutral",
  icon,
  title,
  description,
  detail,
  children,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tone?: Tone;
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  /** Technical details, collapsed by default, copyable. */
  detail?: string;
  /** Action buttons. */
  children?: React.ReactNode;
  dismissible?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (dismissible || o ? onOpenChange(o) : undefined)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-border bg-card p-6 text-center shadow-2xl outline-none duration-200 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-open:slide-in-from-bottom-2 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          <div className="relative mx-auto mb-4 flex size-14 items-center justify-center">
            <span className={cn("absolute inset-0 animate-[pulse-ring_2.4s_ease-out_infinite] rounded-full", TONE[tone])} />
            <span className={cn("relative flex size-14 items-center justify-center rounded-full [&_svg]:size-6", TONE[tone])}>{icon}</span>
          </div>
          <DialogPrimitive.Title className="text-[17px] font-semibold tracking-tight">{title}</DialogPrimitive.Title>
          {description && (
            <DialogPrimitive.Description className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</DialogPrimitive.Description>
          )}
          {detail && <Details text={detail} />}
          {children && <div className="mt-6 flex flex-col gap-2">{children}</div>}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Details({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 text-left">
      <button
        onClick={() => setOpen((v) => !v)}
        className="mx-auto flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        Technical details <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="relative mt-2 animate-in rounded-xl bg-muted p-3 pr-9 duration-200 fade-in slide-in-from-top-1">
          <pre className="selectable max-h-32 overflow-auto font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground">{text}</pre>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="absolute top-2 right-2 rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground"
            aria-label="Copy details"
          >
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          </button>
        </div>
      )}
    </div>
  );
}

/** Full-width dialog button. */
export function DialogButton({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  return (
    <button
      className={cn(
        "inline-flex h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-medium transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
        variant === "primary" && "bg-foreground text-background hover:bg-foreground/90",
        variant === "secondary" && "border border-border bg-card hover:bg-muted",
        variant === "danger" && "bg-destructive text-white hover:bg-destructive/90",
        variant === "ghost" && "text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
