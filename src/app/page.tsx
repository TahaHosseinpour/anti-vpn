"use client";

import { Agentation } from "agentation";
import { Toaster } from "sonner";
import { AppShell } from "@/components/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { VpnProvider } from "@/lib/vpn-context";

export default function Page() {
  return (
    <VpnProvider>
      <TooltipProvider>
        <AppShell />
        <Toaster
          position="top-center"
          closeButton
          toastOptions={{
            classNames: {
              toast: "!rounded-2xl !border-border !bg-card !text-foreground !shadow-xl !gap-3 !px-4 !py-3.5",
              title: "!text-sm !font-semibold",
              description: "!text-xs !text-muted-foreground",
              success: "[&_[data-icon]]:!text-success",
              error: "[&_[data-icon]]:!text-destructive",
              warning: "[&_[data-icon]]:!text-warning",
              info: "[&_[data-icon]]:!text-blue",
              closeButton: "!border-border !bg-card !text-muted-foreground",
            },
          }}
        />
        {/* Visual feedback toolbar for AI agents – development only */}
        {process.env.NODE_ENV === "development" && <Agentation endpoint="http://localhost:4747" />}
      </TooltipProvider>
    </VpnProvider>
  );
}
