"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ItemListWrite } from "@/contracts/api";
import { ApiError, deleteList, getList, updateList } from "@/services/api-client";
import { useAuth } from "@/services/auth/AuthContext";
import { useResource } from "@/lib/useResource";
import { Modal } from "@/components/Modal";
import { Button, EmptyState } from "@/components/ui";
import { ListForm } from "./ListForm";
import { listErrorMessage, mayEditList, usageFromError } from "./items";

/** What happened to the list, handed back so the page can confirm it. */
export type ListChange =
  | {
      kind: "saved";
      id: string;
      name: string;
      /** Items kept after the engine dropped duplicates. */
      kept: number;
      duplicatesDropped: number;
    }
  | { kind: "deleted"; id: string; name: string };

/**
 * Edit, save or delete one list, in a dialog over the lists.
 *
 * Saving closes it and the page confirms what was kept, the same way creating
 * does. Deleting closes it too, once the engine agrees: a list a rule still uses
 * cannot be deleted, and the dialog then names the rules that block it instead
 * of closing on a refusal.
 *
 * The body is keyed on the id and mounted only while open, so opening another
 * list discards everything the last one held (the loaded list, a refusal, an
 * open confirmation, a request still in flight) instead of patching each piece
 * of state by hand.
 */
export function EditListModal({
  id,
  title,
  onClose,
  onChanged,
}: {
  /** The list to open, or null when the dialog is shut. */
  id: string | null;
  /** The list's name when the page already knows it, for the dialog heading. */
  title?: string;
  onClose: () => void;
  onChanged: (change: ListChange) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={id !== null}
      onClose={onClose}
      dismissible={!busy}
      title={title ?? "List"}
    >
      {id !== null ? (
        <ListEditor
          key={id}
          id={id}
          busy={busy}
          setBusy={setBusy}
          onClose={onClose}
          onChanged={onChanged}
        />
      ) : null}
    </Modal>
  );
}

function ListEditor({
  id,
  busy,
  setBusy,
  onClose,
  onChanged,
}: {
  id: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onClose: () => void;
  onChanged: (change: ListChange) => void;
}) {
  const { user } = useAuth();

  const load = useCallback((signal: AbortSignal) => getList(id, { signal }), [id]);
  const list = useResource(load);

  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<ApiError | null>(null);

  const save = async (body: ItemListWrite) => {
    setBusy(true);
    setError(null);
    try {
      const saved = await updateList(id, body);
      setBusy(false);
      onChanged({
        kind: "saved",
        id,
        name: saved.name,
        kept: saved.kept,
        duplicatesDropped: saved.duplicates_dropped,
      });
      onClose();
    } catch (cause) {
      setError(listErrorMessage(cause, "Could not save the list"));
      setBusy(false);
    }
  };

  /*
   * The two delete buttons replace each other, and a focused element that
   * unmounts drops focus to the page body. Focus follows the swap instead, so a
   * keyboard user lands on the button that took the old one's place.
   */
  const alertRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // A refused delete replaces or disables the buttons around it, so focus goes
  // to the message that explains what happened, which stays put.
  useEffect(() => {
    if (deleteError) alertRef.current?.focus();
  }, [deleteError]);

  /*
   * A count that goes up must not leave a confirmation open: while rules use the
   * list the delete cannot be confirmed. Adjusted during render, from the
   * previous count, rather than in an effect. (The blockers alert needs no such
   * rule: "Check again" is the only way the count falls, and it clears the alert
   * itself.)
   */
  const ruleCount = list.data?.rule_count ?? null;
  const [seenRuleCount, setSeenRuleCount] = useState<number | null>(null);
  if (ruleCount !== seenRuleCount) {
    setSeenRuleCount(ruleCount);
    if (ruleCount !== null && ruleCount > 0) setConfirmingDelete(false);
  }

  /*
   * When the count falls to zero the disabled Delete button (and any alert)
   * unmount and a plain "Delete list" takes over, so a focused "Check again"
   * or alert would drop focus to the body. Land on the button that replaced
   * them, but only if focus was actually lost: someone typing elsewhere must
   * not have it taken.
   */
  const previousCount = useRef<number | null>(null);
  useEffect(() => {
    const before = previousCount.current;
    previousCount.current = ruleCount;
    if (before === null || before <= 0 || ruleCount !== 0) return;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) {
      openRef.current?.focus();
    }
  }, [ruleCount]);

  const checkAgain = () => {
    setDeleteError(null);
    list.reload();
  };

  const moveFocus = useRef(false);
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (confirmingDelete ? confirmRef : openRef).current?.focus();
  }, [confirmingDelete]);
  const askDelete = () => {
    moveFocus.current = true;
    setConfirmingDelete(true);
  };
  const cancelDelete = () => {
    moveFocus.current = true;
    setConfirmingDelete(false);
  };

  const data = list.data;

  const remove = async () => {
    setBusy(true);
    setDeleteError(null);
    try {
      await deleteList(id);
      setBusy(false);
      onChanged({ kind: "deleted", id, name: data?.name ?? "the list" });
      onClose();
    } catch (cause) {
      setDeleteError(
        cause instanceof ApiError
          ? cause
          : new ApiError({ kind: "network", message: "Could not delete the list", url: "" }),
      );
      setConfirmingDelete(false);
      setBusy(false);
      // The list may have gained a rule since it loaded; refresh its count.
      list.reload();
    }
  };

  // Only a failure with nothing to show replaces the form. A refetch that fails
  // after the list loaded keeps it, or the analyst loses what they are editing.
  if (list.error && !data) {
    return (
      <div className="space-y-4 p-6">
        <p role="alert" className="text-[13px] leading-relaxed text-secondary">
          <span className="block text-[14px] font-semibold text-ink">Could not load this list</span>
          {list.error.status === 404
            ? "It does not exist, or it was deleted."
            : list.error.displayMessage}
        </p>
        <div className="flex gap-2">
          <Button onClick={list.reload}>Retry</Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    );
  }

  // The list vanished while it was open (deleted in another tab, or just now).
  // Editing it would only produce more 404s, so say so and offer the way out.
  if (data && list.error?.status === 404) {
    return (
      <div className="p-6">
        <EmptyState
          title="This list no longer exists"
          body="It does not exist, or it was deleted."
          action={<Button onClick={onClose}>Close</Button>}
        />
      </div>
    );
  }

  if (list.initial || !data) {
    return <div className="skeleton-sweep m-6 h-72 rounded-[var(--radius)] bg-raised" />;
  }

  const editable = mayEditList(data, user);
  const blockedBy = usageFromError(deleteError);
  // When the structured detail says it all, the engine's sentence would only
  // repeat the names and the count a second and third time.
  const blockersShown = blockedBy.rules.length > 0 || blockedBy.hidden > 0;

  return (
    <>
      {list.error || !editable ? (
        <div className="space-y-2 px-6 pt-5">
          {list.error ? (
            <p
              role="alert"
              className="rounded-[var(--radius-sm)] border border-change/40 bg-change/8 px-3 py-2 text-[12.5px] text-change"
            >
              Could not refresh this list: {list.error.displayMessage}{" "}
              <button type="button" onClick={list.reload} className="font-medium underline">
                Retry
              </button>
            </p>
          ) : null}
          {editable ? null : (
            <p className="rounded-[var(--radius-sm)] border border-line bg-sunken px-3 py-2 text-[12.5px] leading-relaxed text-secondary">
              Only the person who made this list, or an administrator, can change it. You can
              still use it in any rule.
            </p>
          )}
        </div>
      ) : null}

      <ListForm
        initial={{
          name: data.name,
          description: data.description ?? "",
          itemsText: data.items.join("\n"),
        }}
        submitLabel="Save changes"
        busyLabel="Saving…"
        busy={busy}
        readOnly={!editable}
        layout="modal"
        error={error}
        onSubmit={save}
        onCancel={onClose}
        extra={
          editable ? (
            <section
              aria-label="Delete this list"
              className="rounded-[var(--radius)] border border-alert/25 bg-alert/5 p-4"
            >
              <p id="delete-explainer" className="text-[13px] leading-relaxed text-secondary">
                {data.rule_count > 0
                  ? `${data.rule_count} ${data.rule_count === 1 ? "rule uses" : "rules use"} this list. Remove it from ${data.rule_count === 1 ? "that rule" : "those rules"} before deleting.`
                  : "Deleting removes the list and every item in it. No rule uses it."}
              </p>

              {deleteError ? (
                <div
                  ref={alertRef}
                  tabIndex={-1}
                  role="alert"
                  className="mt-3 rounded-[var(--radius-sm)] border border-change/40 bg-change/8 px-3 py-2 text-[12.5px] text-change focus:outline-2 focus:outline-offset-2 focus:outline-accent"
                >
                  {blockersShown ? (
                    <p>This list is still used by:</p>
                  ) : (
                    <p>{deleteError.displayMessage}</p>
                  )}
                  {blockedBy.rules.length > 0 ? (
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                      {blockedBy.rules.map((usage) => (
                        <li key={`${usage.query_id}:${usage.rule_name}`}>
                          <Link
                            href={`/queries/${usage.query_id}`}
                            className="font-medium underline"
                          >
                            {usage.rule_name}
                          </Link>
                          {usage.query_name ? ` on ${usage.query_name}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {blockedBy.hidden > 0 ? (
                    <p className="mt-1.5">
                      {blockedBy.rules.length > 0 ? "Plus " : "Used by "}
                      {blockedBy.hidden} {blockedBy.hidden === 1 ? "rule" : "rules"} on queries
                      you cannot see. Ask an administrator, or the owner of those queries, to
                      remove this list from them.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {data.rule_count > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    tone="danger"
                    disabled
                    aria-describedby="delete-explainer"
                    title="Remove this list from its rules first"
                  >
                    Delete list
                  </Button>
                  <Button type="button" onClick={checkAgain} disabled={busy}>
                    Check again
                  </Button>
                </div>
              ) : confirmingDelete ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button ref={confirmRef} type="button" tone="danger" onClick={remove} disabled={busy}>
                    Delete permanently
                  </Button>
                  <Button type="button" onClick={cancelDelete} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  ref={openRef}
                  type="button"
                  tone="danger"
                  className="mt-3"
                  onClick={askDelete}
                  disabled={busy}
                >
                  Delete list
                </Button>
              )}
            </section>
          ) : null
        }
      />
    </>
  );
}
