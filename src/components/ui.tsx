"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * The small shared pieces.
 *
 * Surfaces lift rather than outline: a hairline plus a soft shadow, radius on
 * everything, and one brand accent that carries interaction. The accent is
 * deliberately not one of the three signal colours - "this button is primary"
 * must never be mistakable for "this row is fraud".
 */

type ButtonTone = "default" | "primary" | "danger" | "ghost";

const TONE: Record<ButtonTone, string> = {
  // Secondary: a raised surface rather than an outline, so a row of buttons
  // reads as a group of objects instead of a row of boxes.
  default:
    "border border-line bg-surface text-ink shadow-sm hover:border-line-strong hover:bg-raised",
  primary:
    "border border-transparent bg-accent text-accent-contrast shadow-[0_1px_2px_rgb(79_70_229/0.4),inset_0_1px_0_rgb(255_255_255/0.18)] hover:bg-accent-hover",
  // Never --signal-alert, which is reserved for data. A destructive control is
  // chrome, however serious it is.
  danger: "border border-alert/30 bg-alert/8 text-alert hover:bg-alert/15",
  // No chrome until hovered: for controls that sit inside dense rows where a
  // border per action would out-shout the data.
  ghost: "border border-transparent text-muted hover:bg-raised hover:text-ink",
};

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-3.5 py-2 text-[13px] font-medium whitespace-nowrap transition-all duration-[var(--tween-fast)] disabled:cursor-not-allowed disabled:opacity-40";

export function Button({
  tone = "default",
  className,
  ...props
}: ComponentProps<"button"> & { tone?: ButtonTone }) {
  return (
    <button {...props} className={`${BUTTON_BASE} ${TONE[tone]} ${className ?? ""}`} />
  );
}

export function LinkButton({
  tone = "default",
  className,
  ...props
}: ComponentProps<typeof Link> & { tone?: ButtonTone }) {
  return <Link {...props} className={`${BUTTON_BASE} ${TONE[tone]} ${className ?? ""}`} />;
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
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[12.5px] font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? <p className="text-[11.5px] text-change">{error}</p> : null}
      {/* Kept beside the error: the hint is the rule the error is about, and
          removing it at the moment of failure takes the answer away. */}
      {hint ? <p className="text-[11.5px] leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}

const CONTROL =
  "w-full rounded-[var(--radius-sm)] border border-line bg-surface px-3 py-2 text-[13.5px] text-ink shadow-sm transition-[border-color,box-shadow] duration-[var(--tween-fast)] placeholder:text-muted/70 hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-dim)] focus:outline-none";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={`${CONTROL} ${className ?? ""}`} />;
}

/** Native `<select>` (so the OS picker and keyboard behaviour are kept) with
 *  the platform chevron swapped for our own, so it matches the inputs. */
const CHEVRON = "select-chevron appearance-none pr-9";

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} className={`${CONTROL} ${CHEVRON} ${className ?? ""}`} />;
}

export function Textarea({ className, ref, ...props }: ComponentProps<"textarea">) {
  // React 19 passes `ref` as an ordinary prop, so no forwardRef is needed.
  return <textarea {...props} ref={ref} className={`${CONTROL} ${className ?? ""}`} />;
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
    <section
      className={`overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-sm ${className ?? ""}`}
    >
      {title ? (
        <header className="flex flex-wrap items-center gap-x-2 gap-y-3 border-b border-line px-5 py-3.5">
          <h2 className="t-section">{title}</h2>
          {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
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
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-line-strong bg-surface/60 px-6 py-16 text-center">
      <p className="t-section">{title}</p>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
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
    <div className="rounded-[var(--radius-lg)] border border-alert/30 bg-surface px-5 py-6 shadow-sm">
      <p className="t-section text-ink">{title}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{message}</p>
      {onRetry ? (
        <Button className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
