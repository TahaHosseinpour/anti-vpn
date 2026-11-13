"use client";

import { Activity, Globe, LayoutList, Moon, Search, Settings2, ShieldCheck, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cleanError, useVpn, type View } from "@/lib/vpn-context";
import { AddConfigDialog } from "./add-config-dialog";
import { DialogHost } from "./feedback/dialog-host";
import { ViewErrorBoundary } from "./feedback/error-view";
import { Logo } from "./logo";
import { ConfigsView } from "./views/configs";
import { HomeView } from "./views/home";
import { KillSwitchView } from "./views/kill-switch";
import { SettingsView } from "./views/settings";
import { StatsView } from "./views/stats";

const NAV: { id: View; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[] = [
  { id: "home", label: "Home", icon: Globe },
  { id: "configs", label: "Configs", icon: LayoutList },
  { id: "killswitch", label: "Kill Switch", icon: ShieldCheck },
  { id: "stats", label: "Statistics", icon: Activity },
];

export function AppShell() {
  const { view, setView, search, setSearch, settings, updateSettings, ready, reportImport } = useVpn();
  const dark = settings?.theme === "dark";
  // Short intro: logo while the app loads, then fade out.
  const [introDone, setIntroDone] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setIntroDone(true), 900);
    return () => clearTimeout(t);
  }, [ready]);

  // Ctrl+V anywhere (outside text fields) imports configs / subscription links from the clipboard.
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "v" || e.shiftKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, [contenteditable=true]") || t.closest("[role=dialog]"))) return;
      e.preventDefault();
      const id = toast.loading("Importing from clipboard…");
      try {
        const r = await api().importClipboard();
        toast.dismiss(id);
        reportImport(r);
        if (r.added.length) setView("configs");
      } catch (err) {
        toast.error("Import failed", { id, description: cleanError(err) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reportImport, setView]);

  return (
    <div className="flex h-screen flex-col bg-shell text-foreground">
      {/* Thin draggable strip – the native window controls sit on its right side */}
      <div className="drag h-9 shrink-0" />

      <div className="flex min-h-0 flex-1">
        {/* Sidebar: logo lines up with the search row, icons line up with the box */}
        <aside className="hidden w-[76px] shrink-0 flex-col items-center pb-8 md:flex xl:pb-10">
          <div className="flex h-10 items-center justify-center">
            <Logo className="size-[22px]" />
          </div>
          <nav className="mt-3 flex flex-col items-center gap-1">
            {NAV.map((n) => (
              <NavButton key={n.id} active={view === n.id} label={n.label} onClick={() => setView(n.id)}>
                <n.icon className="size-[18px]" strokeWidth={1.75} />
              </NavButton>
            ))}
          </nav>
          <div className="flex-1" />
          <NavButton active={view === "settings"} label="Settings" onClick={() => setView("settings")}>
            <Settings2 className="size-[18px]" strokeWidth={1.75} />
          </NavButton>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col px-3 pb-3 sm:px-5 md:pr-8 md:pb-8 md:pl-3 lg:px-16 xl:px-[120px] xl:pb-10">
          {/* Search + theme: exactly as wide as the box below */}
          <header className="flex h-10 shrink-0 items-center gap-2">
            <Logo className="mr-1 size-[22px] shrink-0 md:hidden" />
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (e.target.value && view !== "configs") setView("configs");
                }}
                placeholder="Search configs"
                className="h-10 w-full rounded-full border border-border bg-card pr-9 pl-10 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/30"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-muted"
                  aria-label="Clear search"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={() => void updateSettings({ theme: dark ? "light" : "dark" })}
              className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {dark ? <Sun className="size-4" strokeWidth={1.75} /> : <Moon className="size-4" strokeWidth={1.75} />}
            </button>
          </header>

          {/* The box */}
          <main className="mt-3 min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card">
            <div key={view} className="h-full animate-in overflow-y-auto duration-300 fade-in slide-in-from-bottom-1">
              <ViewErrorBoundary resetKey={view}>
              {!ready ? null : view === "home" ? (
                <HomeView />
              ) : view === "configs" ? (
                <ConfigsView />
              ) : view === "killswitch" ? (
                <KillSwitchView />
              ) : view === "stats" ? (
                <StatsView />
              ) : (
                <SettingsView />
              )}
              </ViewErrorBoundary>
            </div>
          </main>
        </div>
      </div>

      {/* Bottom navigation on narrow windows */}
      <nav className="mx-3 mb-3 flex h-16 shrink-0 items-stretch justify-around rounded-2xl border border-border bg-card/95 px-1 shadow-lg backdrop-blur md:hidden">
        {[...NAV, { id: "settings" as View, label: "Settings", icon: Settings2 }].map((n) => (
          <button
            key={n.id}
            onClick={() => setView(n.id)}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground",
              view === n.id && "text-foreground",
            )}
          >
            <span className={cn("flex h-7 w-12 items-center justify-center rounded-full", view === n.id && "bg-muted")}>
              <n.icon className="size-[18px]" strokeWidth={1.75} />
            </span>
            {n.label}
          </button>
        ))}
      </nav>
      <AddConfigDialog />
      <DialogHost />
      <Intro done={introDone} />
    </div>
  );
}

function Intro({ done }: { done: boolean }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setGone(true), 500);
    return () => clearTimeout(t);
  }, [done]);
  if (gone) return null;
  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-shell transition-opacity duration-500",
        done && "pointer-events-none opacity-0",
      )}
    >
      <div className="flex size-20 animate-in items-center justify-center rounded-[22px] border border-border bg-white shadow-sm duration-700 fade-in zoom-in-90">
        <Logo className="size-10 text-[#0a0a0a]" />
      </div>
      <div className="animate-in text-sm font-semibold tracking-tight duration-700 fade-in slide-in-from-bottom-1">Anti VPN</div>
    </div>
  );
}

function NavButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        aria-label={label}
        className={cn(
          "flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-card hover:text-foreground",
          active && "border border-border bg-card text-foreground",
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
