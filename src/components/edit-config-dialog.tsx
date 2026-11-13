"use client";

import type { Profile } from "@shared/types";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cleanError } from "@/lib/vpn-context";

export function EditConfigDialog({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  return (
    <Dialog open={!!profile} onOpenChange={(o) => !o && onClose()}>
      {profile && <EditForm key={profile.id} profile={profile} onClose={onClose} />}
    </Dialog>
  );
}

function EditForm({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const [name, setName] = useState(profile.name);
  const [country, setCountry] = useState(profile.country ?? "");
  const [json, setJson] = useState(() => JSON.stringify(profile.config, null, 2));
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!profile) return;
    let config: Record<string, unknown> | undefined;
    const original = JSON.stringify(profile.config, null, 2);
    if (json !== original) {
      try {
        config = JSON.parse(json);
      } catch (e) {
        setErr(`Invalid JSON: ${(e as Error).message}`);
        return;
      }
    }
    try {
      await api().updateProfile(profile.id, {
        name: name.trim() || profile.name,
        country: country.trim().toUpperCase() || undefined,
        ...(config ? { config } : {}),
      });
      toast.success("Saved");
      onClose();
    } catch (e) {
      setErr(cleanError(e));
    }
  };

  return (
      <DialogContent className="gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit config</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-4 gap-3">
          <div className="col-span-3 flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Country code</Label>
            <Input value={country} maxLength={2} onChange={(e) => setCountry(e.target.value)} placeholder="DE" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">sing-box options (advanced)</Label>
          <Textarea value={json} onChange={(e) => setJson(e.target.value)} className="h-72 resize-none font-mono text-xs" spellCheck={false} />
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="rounded-full" onClick={onClose}>
            Cancel
          </Button>
          <Button className="rounded-full" onClick={() => void save()}>
            Save
          </Button>
        </div>
      </DialogContent>
  );
}
