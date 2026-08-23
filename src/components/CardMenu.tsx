"use client";

import { useState } from "react";
import Link from "next/link";
import type { ChartType, SavedQueryRead } from "@/contracts/api";
import { CHART_TYPES } from "@/contracts/api";
import { ApiError, deleteQuery, runQuery, updateQuery } from "@/services/api-client";
import { useDashboards } from "@/services/dashboards";
import { Popover, usePopoverClose } from "./Popover";

/**
 * Per-card actions: pick how this query is drawn, run it, edit it, delete it.
 *
 * Chart type is a property of the saved query, not a view preference, so
 * choosing one writes through to the engine. Every other card showing the same
 * query - on a dashboard, on the connection grid - therefore agrees, which is
 * the behaviour an analyst expects from something that persists.
 *
 * Built on `Popover`, so it closes on an option, on an outside click and on
 * Escape. Every item here except the delete confirmation dismisses the menu:
 * picking a chart type and then having to click away to see the chart redraw is
 * the menu getting in the way of its own result.
 */

const CHART_LABELS: Record<ChartType, string> = {
  line: "Line",
  bar: "Bar",
  pie: "Pie",
  number: "Number",
  table: "Table",
};

export interface CardMenuProps {
  query: SavedQueryRead;
  /** Called after the query is changed on the engine. */
  onMutated?: () => void;
  /** Called after the query is deleted. */
  onDeleted?: () => void;
  /** Extra items, e.g. "remove from this dashboard". */
  extra?: React.ReactNode;
}

export function CardMenu({ query, onMutated, onDeleted, extra }: CardMenuProps) {
  return (
    <Popover
      label={`Actions for ${query.name}`}
      title="Chart actions"
      trigger={<span aria-hidden="true">⋯</span>}
      triggerClassName="cursor-pointer list-none px-1 text-[13px] leading-none text-muted transition-colors hover:text-live"
      panelClassName="absolute top-full right-0 z-30 mt-1 w-52 border border-line-strong bg-raised py-1"
    >
      <CardMenuPanel query={query} onMutated={onMutated} onDeleted={onDeleted} extra={extra} />
    </Popover>
  );
}

/**
 * Split from the trigger so everything here sits *inside* the popover and can
 * therefore reach `usePopoverClose`.
 */
function CardMenuPanel({ query, onMutated, onDeleted, extra }: CardMenuProps) {
  const close = usePopoverClose();
  const { reload: reloadDashboards } = useDashboards();
  const [busy, setBusy] = useState<null | "chart" | "run" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const fail = (cause: unknown, fallback: string) =>
    setError(cause instanceof ApiError ? cause.displayMessage : fallback);

  /*
   * Every action here dismisses the menu when it succeeds and keeps it open
   * when it fails. Closing first would be simpler and wrong: the panel holds
   * the error message, so a menu that closes on click reports "could not change
   * the chart type" to an element that is no longer on the page. `close()` is
   * therefore last, after the `finally`, and only on the success path.
   */
  const chooseChart = async (chartType: ChartType) => {
    if (chartType === query.chart_type) {
      close();
      return;
    }
    setBusy("chart");
    setError(null);
    let ok = false;
    try {
      await updateQuery(query.id, { chart_type: chartType });
      onMutated?.();
      ok = true;
    } catch (cause) {
      fail(cause, "Could not change the chart type");
    } finally {
      setBusy(null);
    }
    if (ok) close();
  };

  const run = async () => {
    setBusy("run");
    setError(null);
    let ok = false;
    try {
      await runQuery(query.id);
      onMutated?.();
      ok = true;
    } catch (cause) {
      fail(cause, "The query failed to run");
    } finally {
      setBusy(null);
    }
    if (ok) close();
  };

  const remove = async () => {
    setBusy("delete");
    setError(null);
    try {
      await deleteQuery(query.id);
      // No dashboard cleanup needed: the engine cascades the delete through
      // dashboard membership, so no board is left pointing at a missing query.
      reloadDashboards();
      onDeleted?.();
      close();
    } catch (cause) {
      fail(cause, "Could not delete the query");
      setBusy(null);
    }
  };

  /*
   * No reset-on-close needed: the panel is unmounted while the menu is shut, so
   * a half-finished delete confirmation cannot be waiting the next time it
   * opens.
   */
  return (
    <>
        <p className="px-2.5 pt-1 pb-1.5 text-[10px] tracking-widest text-muted uppercase">
          Chart
        </p>
        <ul className="px-1.5 pb-1">
          {CHART_TYPES.map((type) => {
            const selected = type === query.chart_type;
            return (
              <li key={type}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => chooseChart(type)}
                  aria-pressed={selected}
                  className={`flex w-full items-center gap-2 px-1 py-1 text-left text-[12px] transition-colors disabled:opacity-40 ${
                    selected ? "text-live" : "text-muted hover:text-ink"
                  }`}
                >
                  {/* A mark, not just colour, shows which type is active. */}
                  <span aria-hidden="true" className="tnum w-3 shrink-0">
                    {selected ? "•" : ""}
                  </span>
                  <span>{CHART_LABELS[type]}</span>
                  {busy === "chart" && selected ? null : null}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-1 border-t border-line pt-1">
          <MenuButton onClick={run} disabled={busy !== null} keepOpen>
            {busy === "run" ? "Running…" : "Run now"}
          </MenuButton>

          <Link
            href={`/queries/${query.id}`}
            onClick={close}
            className="block w-full px-2.5 py-1 text-left text-[12px] text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            Edit query
          </Link>

          {extra}
        </div>

        <div className="mt-1 border-t border-line pt-1">
          {confirming ? (
            <>
              <MenuButton onClick={remove} disabled={busy !== null} tone="danger" keepOpen>
                {busy === "delete" ? "Deleting…" : "Delete permanently"}
              </MenuButton>
              <MenuButton onClick={() => setConfirming(false)} disabled={busy !== null} keepOpen>
                Cancel
              </MenuButton>
            </>
          ) : (
            <MenuButton
              onClick={() => setConfirming(true)}
              disabled={busy !== null}
              tone="danger"
              keepOpen
            >
              Delete query
            </MenuButton>
          )}
        </div>

        {error ? (
          <p className="px-2.5 pt-1.5 text-[10px] leading-snug text-change">{error}</p>
        ) : null}
    </>
  );
}

/**
 * Exported so anything adding to a card's menu through `extra` gets the same
 * affordance rather than re-typing the classes and drifting from it.
 */
export function MenuButton({
  onClick,
  disabled,
  tone,
  keepOpen,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone?: "danger";
  /**
   * Leave the menu open after this item. For the two steps of a confirmation,
   * where closing would throw away the question, and for repeatable actions
   * like nudging a card along a board.
   */
  keepOpen?: boolean;
  children: React.ReactNode;
}) {
  const close = usePopoverClose();

  return (
    <button
      type="button"
      onClick={() => {
        onClick();
        if (!keepOpen) close();
      }}
      disabled={disabled}
      className={`block w-full px-2.5 py-1 text-left text-[12px] transition-colors disabled:opacity-40 ${
        tone === "danger"
          ? "text-change hover:bg-surface"
          : "text-muted hover:bg-surface hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
