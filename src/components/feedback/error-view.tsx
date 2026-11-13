"use client";

import { Check, Copy, RotateCcw } from "lucide-react";
import { Component, useState } from "react";
import { Logo } from "../logo";

/** Designed full-page error screen (used by the error boundary and Next's error pages). */
export function ErrorView({
  code,
  title,
  message,
  detail,
  onRetry,
  retryLabel = "Try again",
}: {
  code?: string;
  title: string;
  message: string;
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex h-full min-h-[360px] w-full animate-in flex-col items-center justify-center px-6 text-center duration-500 fade-in">
      <div className="mb-6 flex size-16 items-center justify-center rounded-[20px] border border-border bg-white shadow-sm">
        <Logo className="size-8 text-[#0a0a0a]" />
      </div>
      {code && <div className="mb-2 font-mono text-xs tracking-widest text-muted-foreground">{code}</div>}
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{message}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background transition active:scale-[0.98]"
          >
            <RotateCcw className="size-4" /> {retryLabel}
          </button>
        )}
        {detail && (
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(detail);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm font-medium hover:bg-muted"
          >
            {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy error details"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Catches render errors inside a view so the rest of the app keeps working. */
export class ViewErrorBoundary extends Component<{ children: React.ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return (
        <ErrorView
          code="ERROR"
          title="This page ran into a problem"
          message="Something unexpected happened while showing this page. Your VPN connection is not affected."
          detail={`${this.state.error.message}\n${this.state.error.stack ?? ""}`}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}
