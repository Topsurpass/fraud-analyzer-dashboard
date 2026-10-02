"use client";

import { useState, type ReactNode } from "react";
import type { PartState, PartStatus } from "@/services/querybuilder/model";
import { TARGETS } from "@/services/querybuilder/model";

/**
 * The frame of the query builder: a numbered card for each part of the job, and the
 * outline that lists them with where each one stands.
 *
 * The page used to be one long form in no stated order. People wrote SQL and could
 * not find Preview, added a chart and did not know the pickers wait for a preview,
 * and lost the preview once the rules grew. Numbering the parts, saying what each
 * is for, and keeping a status for each in view at all times answers "what do I do
 * next" without reading the page.
 */

const STATE_LABEL: Record<PartState, string> = {
  todo: "to do",
  attention: "needs attention",
  done: "done",
  optional: "optional",
};

export function StepBadge({ n, state }: { n: number; state: PartState }) {
  const base =
    "grid size-6 shrink-0 place-items-center rounded-full border text-[11.5px] font-semibold tabular-nums transition-colors";
  if (state === "done") {
    return (
      <span aria-hidden="true" className={`${base} border-accent bg-accent text-accent-contrast`}>
        <svg width={12} height={12} viewBox="0 0 12 12" fill="none">
          <path d="m2.5 6.3 2.2 2.2 4.8-5" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (state === "attention") {
    return (
      <span aria-hidden="true" className={`${base} border-change bg-change/12 text-change`}>
        !
      </span>
    );
  }
  if (state === "optional") {
    return (
      <span aria-hidden="true" className={`${base} border-dashed border-line-strong text-muted`}>
        {n}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={`${base} border-line-strong bg-surface text-secondary`}>
      {n}
    </span>
  );
}

/** Scroll to a part and put the cursor where the work is. */
export function jumpTo(target: string) {
  const element = document.getElementById(target);
  if (!element) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const isControl = element.matches("input, textarea, select, button");
  // A section has its own top margin to clear the sticky outline; a bare field does
  // not, so it is centred instead of being tucked underneath it.
  element.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: isControl ? "center" : "start" });
  const focusable = isControl ? element : element.querySelector<HTMLElement>("input, textarea, select, button");
  // After the scroll has started, so the browser does not fight it for the position.
  window.setTimeout(() => focusable?.focus({ preventScroll: true }), 120);
}

/**
 * Bring a part into view if most of it is off screen, without moving focus.
 *
 * For the first preview: the person pressed Run and the result lands below the fold,
 * which reads as "nothing happened". Scrolling only when it is mostly hidden keeps a
 * result that is already in view where it is.
 */
export function revealIfHidden(target: string) {
  const element = document.getElementById(target);
  if (!element) return;
  const rect = element.getBoundingClientRect();
  // The sticky outline and the bar cover roughly the top 64px and bottom 96px.
  const visible = Math.min(rect.bottom, innerHeight - 96) - Math.max(rect.top, 64);
  if (visible >= Math.min(rect.height, 240)) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/**
 * The steps in order, sticky at the top. The first one still needing something is
 * ringed and named in "Next", so a person who does not know the page is told where
 * to go.
 */
export function Outline({
  parts,
  onJump,
  actions,
}: {
  parts: PartStatus[];
  onJump: (target: string) => void;
  actions: ReactNode;
}) {
  const next = parts.find((part) => part.state === "todo" || part.state === "attention");
  const [menuOpen, setMenuOpen] = useState(false);
  const nextIndex = next ? parts.indexOf(next) : parts.length - 1;
  return (
    <div className="sticky top-0 z-30 -mx-4 mb-5 border-b border-line bg-bg px-4 py-2.5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      {/* Phones: one line that says where you are and what is next. The full list is a tap away. */}
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          aria-expanded={menuOpen}
          aria-controls="qb-steps-menu"
          className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] text-left"
        >
          <StepBadge n={nextIndex + 1} state={parts[nextIndex].state} />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-[11.5px] text-muted tabular-nums">
              Step {nextIndex + 1} of {parts.length}
            </span>
            <span className="block truncate text-[13.5px] font-medium text-ink">
              {next ? next.note : "Ready to save"}
            </span>
          </span>
          <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
            {parts.map((part) => (
              <span
                key={part.id}
                className={`size-1.5 rounded-full ${
                  part.id === next?.id
                    ? "bg-accent"
                    : part.state === "done"
                      ? "bg-accent/45"
                      : part.state === "attention"
                        ? "bg-change"
                        : "bg-line-strong"
                }`}
              />
            ))}
          </span>
          <span className="shrink-0 text-[12px] font-medium text-accent">{menuOpen ? "Hide" : "All steps"}</span>
        </button>
        {menuOpen ? (
          <ol id="qb-steps-menu" className="mt-2 space-y-0.5 border-t border-line pt-2">
            {parts.map((part, index) => (
              <li key={part.id}>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onJump(TARGETS[part.id]);
                  }}
                  aria-label={`${part.label}: ${STATE_LABEL[part.state]}. ${part.note}`}
                  className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-1 py-2 text-left hover:bg-raised"
                >
                  <StepBadge n={index + 1} state={part.state} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium text-ink">{part.label}</span>
                    <span className={`block truncate text-[12px] ${part.state === "attention" ? "text-change" : "text-muted"}`}>
                      {part.note}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      <div className="hidden items-center gap-3 md:flex">
        <nav aria-label="Steps" className="min-w-0 flex-1">
          <ol className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
            {parts.map((part, index) => {
              const isNext = next?.id === part.id;
              return (
                <li key={part.id} className="flex shrink-0 items-center">
                  {index > 0 ? (
                    <span aria-hidden="true" className="mx-0.5 h-px w-4 bg-line-strong" />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onJump(TARGETS[part.id])}
                    aria-label={`${part.label}: ${STATE_LABEL[part.state]}. ${part.note}`}
                    aria-current={isNext ? "step" : undefined}
                    className={`group flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors hover:bg-raised ${
                      isNext ? "bg-accent-soft ring-1 ring-accent/30" : ""
                    }`}
                  >
                    <StepBadge n={index + 1} state={part.state} />
                    <span className="min-w-0 leading-tight">
                      <span className="block text-[13px] font-medium text-ink">{part.label}</span>
                      <span
                        className={`block max-w-[11rem] truncate text-[11.5px] ${
                          part.state === "attention" ? "text-change" : "text-muted"
                        }`}
                      >
                        {part.note}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
    </div>
  );
}

/** One numbered part of the job: what it is for, then its controls. */
export function StepCard({
  id,
  step,
  title,
  purpose,
  state,
  actions,
  children,
}: {
  id: string;
  step: number;
  title: string;
  purpose: ReactNode;
  state: PartState;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-24 overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-sm"
    >
      <header className="flex items-start gap-3 border-b border-line px-5 py-3.5">
        <span className="mt-0.5">
          <StepBadge n={step} state={state} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-title`} className="text-[14.5px] font-semibold tracking-tight text-ink">
            {title}
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{purpose}</p>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
