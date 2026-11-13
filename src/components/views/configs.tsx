"use client";

import type { Profile } from "@shared/types";
import { ArrowDownUp, Check, Copy, Loader2, MoreVertical, Pencil, Plus, RefreshCw, Star, Trash2, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { protocolGroup } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cleanError, useVpn } from "@/lib/vpn-context";
import { Card, PingBadge } from "../bits";
import { EditConfigDialog } from "../edit-config-dialog";
import { Flag } from "../flag";

type Filter = "all" | "favorites" | "v2ray" | "ssh" | "wireguard" | "openvpn" | `sub:${string}`;

const CHIPS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "favorites", label: "Favorites" },
  { id: "v2ray", label: "V2Ray" },
  { id: "ssh", label: "SSH" },
  { id: "wireguard", label: "WireGuard" },
  { id: "openvpn", label: "OpenVPN" },
];

export function ConfigsView() {
  const { profiles, subscriptions, refreshSubscriptions, search, ping, pingAll, isPinging, settings, updateSettings, state, connect, setAddDialogOpen, reportImport, confirm } =
    useVpn();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Profile | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const sortBy = settings?.sortBy ?? "ping";

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = profiles.filter((p) => {
      if (filter === "favorites" && !p.favorite) return false;
      if (filter.startsWith("sub:") && p.subscriptionId !== filter.slice(4)) return false;
      if (["v2ray", "ssh", "wireguard", "openvpn"].includes(filter) && protocolGroup(p.protocol) !== filter) return false;
      if (q && !`${p.name} ${p.host} ${p.detail} ${p.country ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "recent") return (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt);
      const pa = a.ping === undefined ? 1e9 : a.ping < 0 ? 1e8 : a.ping;
      const pb = b.ping === undefined ? 1e9 : b.ping < 0 ? 1e8 : b.ping;
      return pa - pb;
    });
    return list;
  }, [profiles, filter, search, sortBy]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: profiles.length, favorites: 0, v2ray: 0, ssh: 0, wireguard: 0, openvpn: 0 };
    for (const p of profiles) {
      c[protocolGroup(p.protocol)]++;
      if (p.favorite) c.favorites++;
      if (p.subscriptionId) c[`sub:${p.subscriptionId}`] = (c[`sub:${p.subscriptionId}`] ?? 0) + 1;
    }
    return c;
  }, [profiles]);

  const timedOut = visible.filter((p) => p.ping !== undefined && p.ping < 0);
  const activeSub = filter.startsWith("sub:") ? subscriptions.find((s) => s.id === filter.slice(4)) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 sm:p-5">
      {/* Chips */}
      <div className="flex flex-wrap items-center gap-2">
        {CHIPS.filter((c) => c.id === "all" || counts[c.id]).map((c) => (
          <Chip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)}>
            {c.label}
            
          </Chip>
        ))}
        {subscriptions.map((s) => (
          <Chip key={s.id} active={filter === `sub:${s.id}`} onClick={() => setFilter(`sub:${s.id}`)}>
            <RefreshCw className="size-3" />
            {s.name}
          </Chip>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="flex-1 text-[13px] text-muted-foreground">
          {activeSub ? (
            <>
              Subscription · updated {activeSub.updatedAt ? new Date(activeSub.updatedAt).toLocaleString() : "never"}
              {activeSub.error && <span className="text-destructive"> · {activeSub.error}</span>}
            </>
          ) : search ? (
            `${visible.length} result${visible.length === 1 ? "" : "s"} for “${search}”`
          ) : (
            "Select a config"
          )}
        </span>
        {activeSub && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={refreshing === activeSub.id}
              onClick={async () => {
                setRefreshing(activeSub.id);
                try {
                  reportImport(await api().refreshSubscription(activeSub.id));
                } finally {
                  setRefreshing(null);
                  void refreshSubscriptions();
                }
              }}
            >
              <RefreshCw className={cn(refreshing === activeSub.id && "animate-spin")} /> Update
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-destructive"
              onClick={async () => {
                const n = counts[`sub:${activeSub.id}`] ?? 0;
                const ok = await confirm({
                  title: `Remove “${activeSub.name}”?`,
                  message: `The subscription and its ${n} config${n === 1 ? "" : "s"} will be removed. This can't be undone.`,
                  confirmLabel: "Remove subscription",
                  tone: "danger",
                });
                if (!ok) return;
                await api().removeSubscription(activeSub.id);
                setFilter("all");
                void refreshSubscriptions();
              }}
            >
              <Trash2 /> Remove
            </Button>
          </>
        )}
        {timedOut.length > 0 && !ping.running && (
          <Button
            variant="outline"
            size="sm"
            className="animate-in rounded-full border-destructive/30 text-destructive duration-200 fade-in hover:bg-destructive/5 hover:text-destructive"
            onClick={async () => {
              const ids = timedOut.map((p) => p.id);
              const ok = await confirm({
                title: `Delete ${ids.length} timed-out config${ids.length === 1 ? "" : "s"}?`,
                message: "Configs that did not respond to the last ping will be permanently removed.",
                confirmLabel: `Delete ${ids.length}`,
                tone: "danger",
              });
              if (ok) await api().removeProfiles(ids);
            }}
          >
            <Trash2 /> Remove timed out
            <span className="rounded-full bg-destructive/10 px-1.5 text-[11px] tabular-nums">{timedOut.length}</span>
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          disabled={ping.running || !profiles.length}
          onClick={() => pingAll(visible.map((p) => p.id))}
        >
          {ping.running ? <Loader2 className="animate-spin" /> : <Zap />}
          {ping.running ? `Pinging ${ping.done}/${ping.total}` : "Ping all"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Sort">
                <ArrowDownUp />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuGroup>
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sortBy} onValueChange={(v) => void updateSettings({ sortBy: v as typeof sortBy })}>
              <DropdownMenuRadioItem value="ping">Ping</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="recent">Recently used</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" className="rounded-full" onClick={() => setAddDialogOpen(true)}>
          <Plus /> Add config
        </Button>
      </div>

      {ping.running && (
        <div className="h-1 shrink-0 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-blue transition-all duration-300" style={{ width: `${(ping.done / Math.max(1, ping.total)) * 100}%` }} />
        </div>
      )}

      {/* List */}
      {visible.length ? (
        <Card className="min-h-0 flex-1 overflow-y-auto">
          {visible.map((p, i) => {
            const active = state.profileId === p.id && state.status !== "disconnected";
            return (
              <div
                key={p.id}
                onClick={() => !active && void connect(p.id)}
                className={cn(
                  "group flex cursor-pointer items-center gap-3 px-3 py-3 transition-colors hover:bg-muted/50",
                  i > 0 && "border-t border-border",
                )}
              >
                <Flag code={p.country} className="size-7" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    {p.favorite && <Star className="size-3 shrink-0 fill-warning text-warning" />}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {p.detail} · {p.host}:{p.port}
                  </div>
                </div>
                <PingBadge key={`${p.id}-${p.pingAt ?? 0}`} ms={p.ping} loading={isPinging(p.id)} />
                {active && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                    {state.status === "connected" ? <Check className="size-3.5" /> : <Loader2 className="size-3.5 animate-spin" />}
                    {state.status === "connected" ? "Connected" : "Connecting"}
                  </span>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    onClick={(e) => e.stopPropagation()}
                    render={
                      <Button variant="ghost" size="icon-sm" className="rounded-full text-muted-foreground" aria-label="Actions">
                        <MoreVertical />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="min-w-44">
                    <DropdownMenuItem onClick={() => pingAll([p.id])}>
                      <Zap /> Ping
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void api().updateProfile(p.id, { favorite: !p.favorite })}>
                      <Star /> {p.favorite ? "Remove favorite" : "Add to favorites"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setEditing(p)}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(await api().exportLink(p.id));
                          toast.success("Copied to clipboard");
                        } catch (e) {
                          toast.error(cleanError(e));
                        }
                      }}
                    >
                      <Copy /> Copy link
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Delete this config?",
                          message: `“${p.name}” will be permanently removed.${active ? " You'll be disconnected first." : ""}`,
                          confirmLabel: "Delete",
                          tone: "danger",
                        });
                        if (ok) await api().removeProfiles([p.id]);
                      }}
                    >
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </Card>
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-14 text-center">
          <div className="text-sm font-medium">{profiles.length ? "No configs match" : "No configs yet"}</div>
          <p className="max-w-sm text-xs text-muted-foreground">
            Paste V2Ray links (vmess, vless, trojan, ss, hysteria2), SSH accounts, Windscribe WireGuard / OpenVPN files, or a subscription URL.
          </p>
          <Button className="rounded-full" onClick={() => setAddDialogOpen(true)}>
            <Plus /> Add config
          </Button>
        </Card>
      )}

      <EditConfigDialog profile={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
        active ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
