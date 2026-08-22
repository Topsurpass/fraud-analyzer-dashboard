"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * The small shared pieces. Flat surfaces, hairline borders, no rounded pills or
 * shadows: the brief calls for a schematic, and controls that look like a
 * marketing site would fight the instrument panel around them.
 */

type ButtonTone = "default" | "primary" | "danger";

const TONE: Record<ButtonTone, string> = {
  default:
    "border-line-strong text-muted hover:border-live hover:text-live disabled:hover:border-line-strong disabled:hover:text-muted",
  primary: "border-live text-live hover:bg-live/10",
  // "danger" earns a warmer border because it guards a destructive action; it
  // never uses --signal-alert, which the brief reserves for chart data.
  danger: "border-change/60 text-change hover:bg-change/10",
};

export function Button({
  tone = "default",
  className,
  ...props
}: ComponentProps<"button"> & { tone?: ButtonTone }) {
  return (
    <button
      {...props}
      className={`border px-2.5 py-1 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${TONE[tone]} ${className ?? ""}`}
    />
  );
}

export function LinkButton({
  tone = "default",
  className,
  ...props
}: ComponentProps<typeof Link> & { tone?: ButtonTone }) {
  return (
    <Link
      {...props}
      className={`inline-block border px-2.5 py-1 text-[12px] transition-colors ${TONE[tone]} ${className ?? ""}`}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-[11px] text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] text-change">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const CONTROL =
  "w-full border border-line bg-sunken px-2 py-1.5 text-[12px] text-ink placeholder:text-muted/60 focus:border-live focus:outline-none";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={`${CONTROL} ${className ?? ""}`} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} className={`${CONTROL} ${className ?? ""}`} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={`${CONTROL} ${className ?? ""}`} />;
}

export function Panel({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border border-line bg-surface ${className ?? ""}`}>
      {title ? (
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <h2 className="text-[12px] font-medium">{title}</h2>
          {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center border border-dashed border-line px-6 py-12 text-center">
      <p className="text-[13px]">{title}</p>
      <p className="mt-1 max-w-sm text-[12px] text-muted">{body}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/**
 * Failure surface for a whole page. Always paired with a retry: the brief bans
 * silent failure, and that applies to pages as much as to cards.
 */
export function ErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="border border-line bg-surface px-4 py-6">
      <p className="text-[13px]">{title}</p>
      <p className="mt-1 text-[12px] text-muted">{message}</p>
      {onRetry ? (
        <Button className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
