"use client";

import { AlertTriangle, Cpu, Loader2, RotateCcw, ShieldAlert, ShieldCheck, Trash2, WifiOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useVpn } from "@/lib/vpn-context";
import { AppDialog, DialogButton } from "./app-dialog";

/** Renders whichever app dialog is currently requested through the context. */
export function DialogHost() {
  const { dialog, setDialog, connect, setView, profiles } = useVpn();
  const [busy, setBusy] = useState(false);
  const close = () => setDialog(null);

  if (!dialog) return null;

  if (dialog.kind === "admin") {
    return (
      <AppDialog
        open
        onOpenChange={(o) => !o && close()}
        tone="warning"
        icon={<ShieldAlert />}
        title="Administrator permission needed"
        description={
          <>
            To route all traffic through the VPN and keep the Kill Switch airtight, Anti VPN needs to run as administrator.
            <span className="mt-2 block text-xs">Windows will ask you to confirm on the next screen.</span>
          </>
        }
      >
        <DialogButton
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api().relaunchAsAdmin();
            } catch {
              toast.error("Permission was not granted", { description: "Anti VPN can't connect without administrator rights." });
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
          {busy ? "Waiting for Windows…" : "Restart as administrator"}
        </DialogButton>
        <DialogButton variant="ghost" onClick={close}>
          Not now
        </DialogButton>
      </AppDialog>
    );
  }

  if (dialog.kind === "core") {
    return (
      <AppDialog
        open
        onOpenChange={(o) => !o && close()}
        tone="danger"
        icon={<Cpu />}
        title="VPN engine is missing"
        description="The connection engine (sing-box) was not found. Reinstall Anti VPN to restore it."
        detail="Expected at resources/bin/sing-box.exe. During development run: npm run fetch-core"
      >
        <DialogButton onClick={close}>OK</DialogButton>
      </AppDialog>
    );
  }

  if (dialog.kind === "connect-failed") {
    const profile = profiles.find((p) => p.id === dialog.profileId);
    return (
      <AppDialog
        open
        onOpenChange={(o) => !o && close()}
        tone="danger"
        icon={<WifiOff />}
        title="Couldn't connect"
        description={
          <>
            {dialog.message}
            {profile && <span className="mt-1 block text-xs">Config: {profile.name}</span>}
          </>
        }
        detail={dialog.detail}
      >
        {profile && (
          <DialogButton
            onClick={() => {
              close();
              void connect(profile.id);
            }}
          >
            <RotateCcw /> Try again
          </DialogButton>
        )}
        <DialogButton
          variant="secondary"
          onClick={() => {
            close();
            setView("configs");
          }}
        >
          Choose another config
        </DialogButton>
        <DialogButton variant="ghost" onClick={close}>
          Close
        </DialogButton>
      </AppDialog>
    );
  }

  // confirm
  const answer = (ok: boolean) => {
    dialog.resolve(ok);
    close();
  };
  return (
    <AppDialog
      open
      onOpenChange={(o) => !o && answer(false)}
      tone={dialog.tone === "danger" ? "danger" : "neutral"}
      icon={dialog.tone === "danger" ? <Trash2 /> : <AlertTriangle />}
      title={dialog.title}
      description={dialog.message}
    >
      <DialogButton variant={dialog.tone === "danger" ? "danger" : "primary"} onClick={() => answer(true)}>
        {dialog.confirmLabel}
      </DialogButton>
      <DialogButton variant="ghost" onClick={() => answer(false)}>
        Cancel
      </DialogButton>
    </AppDialog>
  );
}

