"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FlagRule, PreviewResponse } from "@/contracts/api";
import { ApiError, previewQuery } from "@/services/api-client";
import { buildTable } from "@/services/charts/shape";
import { formatInteger } from "@/services/format";
import { FlagRuleEditor, validateRules } from "@/components/FlagRuleEditor";
import { TableView } from "@/components/charts/TableView";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui";

/**
 * Writing rules without losing sight of what they catch.
 *
 * Rules used to be a panel on the page that grew with every condition, pushing the
 * preview further down until it was off the screen: the one thing a rule author is
 * looking at while they type. This is a workspace instead. The rules are on the
 * left and scroll inside their own pane; the rows they flag are on the right and
 * never move, with a live count ("catches 12 of 100 rows") that follows every
 * change after a short pause. Save and Cancel are fixed in a footer, and Save
 * applies the whole set at once, as the old editor's Save did.
 */

const PREVIEW_DELAY_MS = 600;

/** The rules complete enough to send, and where each sits in the working list. */
function completeRules(rules: FlagRule[]): { rule: FlagRule; index: number }[] {
  const problems = validateRules(rules);
  return rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ index }) => {
      for (const key of problems.keys()) {
        if (key === `rule:${index}` || key.startsWith(`cond:${index}:`)) return false;
      }
      return true;
    });
}

interface Live {
  preview: PreviewResponse | null;
  error: ApiError | null;
  running: boolean;
  /** The rules (and SQL) this preview was run for. */
  forSignature: string | null;
}

export function RulesDialog({
  open,
  onClose,
  onSave,
  rules,
  savedRules,
  columns,
  connectionId,
  sql,
}: {
  open: boolean;
  onClose: () => void;
  /** Applies the whole working set to the query being edited. */
  onSave: (rules: FlagRule[]) => void;
  rules: FlagRule[];
  savedRules: FlagRule[];
  columns: string[];
  connectionId: string;
  sql: string;
}) {
  const [working, setWorking] = useState<FlagRule[]>(rules);
  const [wasOpen, setWasOpen] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [wasOpen2, setWasOpen2] = useState(false);
  // Opening starts from what the page holds, never from the last time it was open.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setWorking(rules);
      setConfirmingDiscard(false);
    }
  }

  const dirty = JSON.stringify(working) !== JSON.stringify(rules);
  const problems = useMemo(() => validateRules(working), [working]);
  const incomplete = problems.size > 0;

  const [live, setLive] = useState<Live>({ preview: null, error: null, running: false, forSignature: null });
  const sequence = useRef(0);
  const { complete, signature } = useMemo(() => {
    const complete = completeRules(working);
    return { complete, signature: JSON.stringify(complete.map((entry) => entry.rule)) };
  }, [working]);

  // What a preview has to have been run for to describe the rules on screen.
  const wanted = `${sql}\u0000${signature}`;

  useEffect(() => {
    if (!open || !sql.trim()) return;
    const mine = ++sequence.current;
    const timer = window.setTimeout(async () => {
      setLive((current) => ({ ...current, running: true, error: null }));
      try {
        const preview = await previewQuery(connectionId, {
          sql_text: sql,
          flag_rules: complete.map((entry) => entry.rule),
        });
        if (mine === sequence.current) {
          setLive({ preview, error: null, running: false, forSignature: `${sql}\u0000${signature}` });
        }
      } catch (cause) {
        if (mine !== sequence.current) return;
        setLive({
          preview: null,
          running: false,
          forSignature: null,
          error:
            cause instanceof ApiError
              ? cause
              : new ApiError({ kind: "network", message: "Preview failed", url: "" }),
        });
      }
    }, PREVIEW_DELAY_MS);
    return () => window.clearTimeout(timer);
    // `signature` stands for the complete rules; the array itself is a new object
    // on every keystroke and would restart the timer for nothing.
  }, [open, sql, connectionId, signature]); // eslint-disable-line react-hooks/exhaustive-deps

  // The preview reports each rule under its position among the ones sent; the
  // editor wants it under the rule's position among all of them.
  const matchCounts = useMemo(() => {
    const hits = live.preview?.flags?.rules;
    if (!hits?.length) return null;
    const counts = new Map<number, number>();
    for (const hit of hits) {
      const sent = Number(hit.id);
      const entry = complete[sent];
      if (entry) counts.set(entry.index, hit.matched);
    }
    return counts;
  }, [live.preview, complete]);

  const table = useMemo(() => {
    if (!live.preview) return null;
    return buildTable({
      columns: live.preview.columns,
      rows: live.preview.rows,
      chart: { id: "preview", name: "Preview", type: "table", x_field: null, y_field: null, series_field: null, warnings: [] },
      flags: live.preview.flags,
    });
  }, [live.preview]);

  const requestClose = () => {
    if (dirty) setConfirmingDiscard(true);
    else onClose();
  };

  // Rules changed since the preview on screen was run: it describes the old ones.
  const pending = live.preview !== null && live.forSignature !== wanted;
  const caught = live.preview?.flags?.flagged_count ?? 0;
  const total = live.preview?.row_count ?? 0;

  // One sentence about what the rules catch, used in the pane header and, on a phone where
  // the preview is on its own tab, in the footer, so the count is never out of sight.
  const matchStatus = (
    <>
      {!sql.trim() ? (
                <span className="text-muted">Write the SQL first.</span>
              ) : complete.length === 0 && working.length > 0 ? (
                // Before anything else: with no complete rule nothing is being checked, so
                // neither "waiting" nor "catches no rows" is the honest thing to say.
                <span className="text-muted">Finish the rule to see what it catches.</span>
              ) : live.error ? (
                <span className="text-change">The preview did not run.</span>
              ) : !live.preview ? (
                <span className="text-muted">{live.running ? "Checking…" : "Waiting for the first preview…"}</span>
              ) : pending ? (
                // Never a number for rules it has not looked at yet.
                <span className="text-muted">Checking your latest change…</span>
              ) : working.length === 0 ? (
                <span className="text-muted">No rules yet, so nothing is flagged.</span>
              ) : (
                <span className={caught > 0 ? "font-medium text-alert" : "text-secondary"}>
                  {caught === 0
                    ? "Catches no rows"
                    : `Catches ${formatInteger(caught)} of ${formatInteger(total)} ${total === 1 ? "row" : "rows"}`}
                </span>
              )}
    </>
  );
  const [pane, setPane] = useState<"rules" | "preview">("rules");
  if (open !== wasOpen2) {
    setWasOpen2(open);
    if (open) setPane("rules");
  }

  return (
    <Modal
      open={open}
      onClose={requestClose}
      size="workspace"
      title="Flag rules"
      description="A row is flagged when any rule matches it. A rule matches when all of its conditions hold. The rows on the right update as you type."
    >
      {/* Below a laptop width the two panes do not fit side by side, so they are tabs. */}
      <div role="tablist" aria-label="Rules or preview" className="flex shrink-0 gap-1 border-b border-line px-4 py-2 lg:hidden">
        {(["rules", "preview"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`rules-tab-${id}`}
            aria-selected={pane === id}
            aria-controls={`rules-panel-${id}`}
            onClick={() => setPane(id)}
            className={`flex-1 rounded-[var(--radius-sm)] px-3 py-1.5 text-[13px] font-medium transition-colors ${
              pane === id ? "bg-accent-soft text-accent" : "text-secondary hover:bg-raised"
            }`}
          >
            {id === "rules" ? "Rules" : "Preview"}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-1 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        <div
          id="rules-panel-rules"
          role="tabpanel"
          aria-labelledby="rules-tab-rules"
          className={`min-h-0 overflow-y-auto border-line lg:block lg:border-r ${pane === "rules" ? "" : "max-lg:hidden"}`}
          data-rules-pane
        >
          <FlagRuleEditor
            bare
            rules={working}
            onChange={setWorking}
            columns={columns}
            // A per-rule count from the previous rules would sit beside "checking…" and disagree.
            matchCounts={pending ? null : matchCounts}
            savedRules={savedRules}
          />
        </div>

        <div
          id="rules-panel-preview"
          role="tabpanel"
          aria-labelledby="rules-tab-preview"
          className={`min-h-0 flex-col lg:flex ${pane === "preview" ? "flex" : "max-lg:hidden"}`}
          data-results-pane
        >
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-3">
            <h3 className="text-[13.5px] font-semibold text-ink">What these rules catch</h3>
            <span aria-live="polite" className="text-[13px]">{matchStatus}</span>
            {live.running && live.preview && !pending ? (
              <span className="text-[12px] text-muted" role="status">Updating…</span>
            ) : null}
            {incomplete ? (
              <span className="ml-auto text-[12px] text-muted">
                Rules that are not finished are left out of this check.
              </span>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {table ? (
              <div className={`flex h-full flex-col overflow-hidden transition-opacity ${live.running || pending ? "opacity-60" : ""}`}>
                <TableView data={table} title="Preview" />
              </div>
            ) : (
              <p className="p-5 text-[13px] text-muted">
                {live.error
                  ? live.error.displayMessage
                  : "The rows this query returns appear here, with the ones a rule catches marked."}
              </p>
            )}
          </div>
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
        <p className="min-w-0 basis-full text-[12.5px] sm:flex-1 sm:basis-0" aria-live="polite">
          <span className="mb-0.5 block text-[13px] lg:hidden">{matchStatus}</span>
          {confirmingDiscard ? (
            <span className="font-medium text-change">Discard the changes you made to the rules?</span>
          ) : incomplete ? (
            <span className="text-change">Finish or remove the rule that is not complete to save.</span>
          ) : dirty ? (
            <span className="text-secondary">Unsaved changes to the rules.</span>
          ) : (
            <span className="text-muted">No changes.</span>
          )}
        </p>
        {confirmingDiscard ? (
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" onClick={() => setConfirmingDiscard(false)}>
              Keep editing
            </Button>
            <Button type="button" tone="danger" onClick={onClose}>
              Discard
            </Button>
          </div>
        ) : (
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" onClick={requestClose}>
              Cancel
            </Button>
            <Button
              type="button"
              tone="primary"
              disabled={incomplete || !dirty}
              onClick={() => {
                onSave(working);
                onClose();
              }}
            >
              Use these rules
            </Button>
          </div>
        )}
      </footer>
    </Modal>
  );
}
