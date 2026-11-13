"use client";

import { ErrorView } from "@/components/feedback/error-view";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="h-screen bg-shell">
      <ErrorView
        code="ERROR"
        title="Something went wrong"
        message="Anti VPN hit an unexpected problem. Try again; if it keeps happening, restart the app."
        detail={`${error.message}${error.digest ? `\ndigest: ${error.digest}` : ""}\n${error.stack ?? ""}`}
        onRetry={reset}
      />
    </div>
  );
}
