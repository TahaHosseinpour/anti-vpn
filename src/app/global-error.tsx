"use client";

import "./globals.css";
import { ErrorView } from "@/components/feedback/error-view";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="h-screen bg-shell text-foreground">
        <ErrorView
          code="FATAL"
          title="Anti VPN needs to restart"
          message="A critical error stopped the app from loading. Try again, or close and reopen Anti VPN."
          detail={`${error.message}${error.digest ? `\ndigest: ${error.digest}` : ""}\n${error.stack ?? ""}`}
          onRetry={reset}
        />
      </body>
    </html>
  );
}
