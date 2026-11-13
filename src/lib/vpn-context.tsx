"use client";

import type { ImportResult, Profile, Settings, Subscription, SystemInfo, TrafficSample, TrafficSnapshot, VpnState } from "@shared/types";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "./api";

export type View = "home" | "configs" | "killswitch" | "stats" | "settings";

export type DialogState =
  | { kind: "admin" }
  | { kind: "core" }
  | { kind: "connect-failed"; message: string; detail?: string; profileId?: string }
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel: string;
      tone: "danger" | "default";
      resolve: (ok: boolean) => void;
    }
  | null;

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "danger" | "default";
}

const RECONNECT_TOAST = "vpn-reconnect";

interface Ctx {
  ready: boolean;
  view: View;
  setView: (v: View) => void;
  search: string;
  setSearch: (s: string) => void;
  system: SystemInfo | null;
  profiles: Profile[];
  subscriptions: Subscription[];
  refreshSubscriptions: () => Promise<void>;
  settings: Settings | null;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  state: VpnState;
  traffic: TrafficSnapshot | null;
  history: TrafficSample[];
  ping: { done: number; total: number; running: boolean };
  pingAll: (ids?: string[]) => void;
  /** True while this profile is waiting for its ping result. */
  isPinging: (id: string) => boolean;
  connect: (id: string) => Promise<void>;
  disconnect: () => Promise<void>;
  toggle: () => Promise<void>;
  activeProfile?: Profile;
  /** profile shown on the home hero when disconnected */
  selectedProfile?: Profile;
  reportImport: (r: ImportResult) => void;
  addDialogOpen: boolean;
  setAddDialogOpen: (v: boolean) => void;
  dialog: DialogState;
  setDialog: (d: DialogState) => void;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  online: boolean;
}

const VpnContext = createContext<Ctx | null>(null);

export function VpnProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("home");
  const [search, setSearch] = useState("");
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [state, setState] = useState<VpnState>({ status: "disconnected", blocking: false });
  const [traffic, setTraffic] = useState<TrafficSnapshot | null>(null);
  const [history, setHistory] = useState<TrafficSample[]>([]);
  const [ping, setPing] = useState({ done: 0, total: 0, running: false });
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [online, setOnline] = useState(true);
  const prevState = useRef<VpnState>({ status: "disconnected", blocking: false });

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    const a = api();
    let alive = true;
    void (async () => {
      const [sys, prof, subs, set, st, tr] = await Promise.all([
        a.getSystemInfo(),
        a.listProfiles(),
        a.listSubscriptions(),
        a.getSettings(),
        a.getState(),
        a.getTraffic(),
      ]);
      if (!alive) return;
      setSystem(sys);
      setProfiles(prof);
      setSubscriptions(subs);
      setSettings(set);
      setState(st);
      setTraffic(tr.snapshot);
      setHistory(tr.history);
      setReady(true);
    })();
    const offs = [
      a.onProfiles((p) => setProfiles([...p])),
      a.onState((s) => {
        const prev = prevState.current;
        prevState.current = s;
        setState(s);
        if (s.status === "reconnecting" && prev.status !== "reconnecting") {
          toast.warning("Connection lost", {
            id: RECONNECT_TOAST,
            duration: Infinity,
            description: s.blocking
              ? "Reconnecting… Kill Switch is blocking traffic until the VPN is back."
              : "Reconnecting to the server automatically…",
          });
        } else if (s.status === "connected" && prev.status === "reconnecting") {
          toast.success("Connection restored", { id: RECONNECT_TOAST, duration: 4000, description: "You're protected again." });
        } else if (s.status === "disconnected" && prev.status !== "disconnected") {
          toast.dismiss(RECONNECT_TOAST);
          if (s.error) setDialog({ kind: "connect-failed", message: s.error, detail: s.errorDetail, profileId: prev.profileId });
        }
      }),
      a.onTraffic((t) => {
        setTraffic(t);
        setHistory((h) => {
          const next = [...h, t.current];
          return next.length > 120 ? next.slice(next.length - 120) : next;
        });
      }),
      a.onPingProgress(setPing),
    ];
    return () => {
      alive = false;
      offs.forEach((f) => f());
    };
  }, []);

  // theme
  useEffect(() => {
    if (!settings) return;
    const apply = () => {
      const dark = settings.theme === "dark" || (settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings?.theme, settings]);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...patch, killSwitch: { ...s.killSwitch, ...(patch.killSwitch ?? {}) } } : s));
    const next = await api().setSettings(patch);
    setSettings(next);
  }, []);

  const refreshSubscriptions = useCallback(async () => {
    setSubscriptions(await api().listSubscriptions());
  }, []);

  const connect = useCallback(async (id: string) => {
    try {
      await api().connect(id);
    } catch (e) {
      const msg = cleanError(e);
      if (msg === "ADMIN_REQUIRED") setDialog({ kind: "admin" });
      else if (msg === "CORE_MISSING") setDialog({ kind: "core" });
      else setDialog({ kind: "connect-failed", message: msg, profileId: id });
    }
  }, []);

  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) =>
        setDialog({
          kind: "confirm",
          title: o.title,
          message: o.message,
          confirmLabel: o.confirmLabel ?? "Confirm",
          tone: o.tone ?? "default",
          resolve,
        }),
      ),
    [],
  );

  const disconnect = useCallback(async () => {
    await api().disconnect();
  }, []);

  const [pingBatch, setPingBatch] = useState<{ ids: Set<string>; at: number } | null>(null);
  const pingAll = useCallback(
    (ids?: string[]) => {
      setPingBatch({ ids: new Set(ids ?? profiles.map((p) => p.id)), at: Date.now() });
      void api().pingAll(ids);
    },
    [profiles],
  );
  const isPinging = useCallback(
    (id: string) => {
      if (!ping.running || !pingBatch || !pingBatch.ids.has(id)) return false;
      const p = profiles.find((x) => x.id === id);
      return !p || (p.pingAt ?? 0) < pingBatch.at;
    },
    [ping.running, pingBatch, profiles],
  );

  const activeProfile = profiles.find((p) => p.id === state.profileId && state.status !== "disconnected");
  const selectedProfile = useMemo(() => {
    if (activeProfile) return activeProfile;
    return (
      profiles.find((p) => p.id === settings?.lastProfileId) ??
      [...profiles].filter((p) => (p.ping ?? -1) > 0).sort((a, b) => a.ping! - b.ping!)[0] ??
      profiles[0]
    );
  }, [activeProfile, profiles, settings?.lastProfileId]);

  const toggle = useCallback(async () => {
    if (state.status === "disconnected") {
      if (selectedProfile) await connect(selectedProfile.id);
      else setView("configs");
    } else {
      await disconnect();
    }
  }, [state.status, selectedProfile, connect, disconnect]);

  const reportImport = useCallback((r: ImportResult) => {
    if (r.added.length) toast.success(`Added ${r.added.length} config${r.added.length > 1 ? "s" : ""}`);
    if (r.errors.length) {
      toast.error(`${r.errors.length} item${r.errors.length > 1 ? "s" : ""} could not be imported`, {
        description: r.errors
          .slice(0, 3)
          .map((e) => e.reason)
          .join("\n"),
      });
    }
    if (!r.added.length && !r.errors.length) toast.info("Nothing new to import (duplicates are skipped)");
    void api().listSubscriptions().then(setSubscriptions);
  }, []);

  const value: Ctx = {
    ready,
    view,
    setView,
    search,
    setSearch,
    system,
    profiles,
    subscriptions,
    refreshSubscriptions,
    settings,
    updateSettings,
    state,
    traffic,
    history,
    ping,
    pingAll,
    isPinging,
    connect,
    disconnect,
    toggle,
    activeProfile,
    selectedProfile,
    reportImport,
    addDialogOpen,
    setAddDialogOpen,
    dialog,
    setDialog,
    confirm,
    online,
  };
  return <VpnContext.Provider value={value}>{children}</VpnContext.Provider>;
}

export function useVpn() {
  const c = useContext(VpnContext);
  if (!c) throw new Error("useVpn outside provider");
  return c;
}

export function cleanError(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}
