"use client";

import { ErrorView } from "@/components/feedback/error-view";

export default function NotFound() {
  return (
    <div className="h-screen bg-shell">
      <ErrorView
        code="404"
        title="Page not found"
        message="This page doesn't exist in Anti VPN."
        retryLabel="Back to home"
        onRetry={() => (window.location.href = "/")}
      />
    </div>
  );
}
