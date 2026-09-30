"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ItemListSaved, ItemListWrite } from "@/contracts/api";
import { ApiError, deleteList, getList, updateList } from "@/services/api-client";
import { useAuth } from "@/services/auth/AuthContext";
import { useLists } from "@/lib/ListsContext";
import { useResource } from "@/lib/useResource";
import { PageBody } from "@/components/PageBody";
import { Button, EmptyState, ErrorState, LinkButton, Panel } from "@/components/ui";
import { ListForm } from "@/components/lists/ListForm";
import {
  listErrorMessage,
  mayEditList,
  usageFromError,
} from "@/components/lists/items";

/**
 * Edit a list, see what it did on save, or delete it when no rule uses it.
 *
 * The inner screen is keyed on the id, so moving between lists discards
 * everything it held (the loaded list, a refusal, an open confirmation, a
 * request still in flight) instead of patching each piece of state by hand.
 */
export default function ListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ListScreen key={id} id={id} />;
}

function ListScreen({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const { reload: reloadLists } = useLists();

  const load = useCallback((signal: AbortSignal) => getList(id, { signal }), [id]);
  const list = useResource(load);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ItemListSaved | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<ApiError | null>(null);

  const crumbs = [{ label: "Lists", href: "/lists" }, { label: list.data?.name ?? "List" }];

  const save = async (body: ItemListWrite) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      setSaved(await updateList(id, body));
      // Refetch rather than trust the form: the engine de-duplicates, so what
      // it stored can differ from what was typed.
      list.reload();
      reloadLists();
    } catch (cause) {
      setError(listErrorMessage(cause, "Could not save the list"));
    } finally {
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
   * A blockers alert describes a moment. Once the count drops back to zero
   * (the rule was removed, and "Check again" or another reload saw it), the
   * alert would contradict the "No rule uses it" line above it, so it goes.
   * Adjusted during render, from the previous count, rather than in an effect.
   */
  const ruleCount = list.data?.rule_count ?? null;
  const [seenRuleCount, setSeenRuleCount] = useState<number | null>(null);
  if (ruleCount !== seenRuleCount) {
    setSeenRuleCount(ruleCount);
    if (ruleCount === 0 && seenRuleCount !== null && seenRuleCount > 0) setDeleteError(null);
    // A count that drops back to zero must not reveal a confirmation nobody
    // asked for: while rules use the list the confirmation cannot be open.
    if (ruleCount !== null && ruleCount > 0) setConfirmingDelete(false);
  }

  /*
   * When the count falls to zero the disabled Delete button (and any alert)
   * unmount and a plain "Delete list" takes over, so a focused "Check again"
   * or alert would drop focus to the body. Land on the button that replaced
   * them, but only if focus was actually lost: someone typing elsewhere on the
   * page must not have it taken.
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

  const remove = async () => {
    setBusy(true);
    setDeleteError(null);
    try {
      await deleteList(id);
      reloadLists();
      router.push("/lists");
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

  // Only a failure with nothing to show replaces the page. A refetch that fails
  // after a good save keeps the form, or the analyst loses the list they just
  // wrote and sees an error for something that succeeded.
  if (list.error && !list.data) {
    return (
      <PageBody crumbs={crumbs}>
        <ErrorState
          title="Could not load this list"
          message={
            list.error.status === 404
              ? "It does not exist, or it was deleted."
              : list.error.displayMessage
          }
          onRetry={list.reload}
        />
      </PageBody>
    );
  }

  const data = list.data;
  // The list vanished while it was open (deleted in another tab, or just now).
  // Editing it would only produce more 404s, so say so and offer the way out.
  if (data && list.error?.status === 404) {
    return (
      <PageBody crumbs={crumbs}>
        <EmptyState
          title="This list no longer exists"
          body="It does not exist, or it was deleted."
          action={<LinkButton href="/lists">Back to lists</LinkButton>}
        />
      </PageBody>
    );
  }
  const editable = data ? mayEditList(data, user) : false;
  const blockedBy = usageFromError(deleteError);
  // When the structured detail says it all, the engine's sentence would only
  // repeat the names and the count a second and third time.
  const blockersShown = blockedBy.rules.length > 0 || blockedBy.hidden > 0;

  return (
    <PageBody crumbs={crumbs}>
      {list.initial || !data ? (
        <div className="skeleton-sweep h-96 max-w-2xl border border-line bg-surface" />
      ) : (
        <div className="max-w-2xl space-y-3">
          {list.error ? (
            <p role="alert" className="border border-change/40 bg-change/5 px-3 py-2 text-[12.5px] text-change">
              Could not refresh this list: {list.error.displayMessage}{" "}
              <button type="button" onClick={list.reload} className="font-medium underline">
                Retry
              </button>
            </p>
          ) : null}

          {saved ? (
            <p
              role="status"
              className="border border-line bg-surface px-3 py-2 text-[12.5px] text-secondary"
            >
              Saved. {saved.kept} {saved.kept === 1 ? "item" : "items"} kept
              {saved.duplicates_dropped > 0
                ? `, ${saved.duplicates_dropped} ${saved.duplicates_dropped === 1 ? "duplicate" : "duplicates"} dropped`
                : ""}
              . Rules that use this list pick up the change on their next poll.
            </p>
          ) : null}

          {editable ? null : (
            <p className="border border-line bg-surface px-3 py-2 text-[12.5px] text-secondary">
              Only the person who made this list, or an administrator, can change it. You can
              still use it in any rule.
            </p>
          )}

          <Panel title={data.name}>
            <ListForm
              // After a save the fields are replaced from the response, so the box
              // shows what the engine kept (de-duplicated) rather than what was
              // typed. Replaced in place, not remounted, or the Save button or
              // field the analyst was in would lose focus. Other reloads never
              // touch what is being typed.
              version={saved?.updated_at ?? "loaded"}
              initial={{
                name: (saved ?? data).name,
                description: (saved ?? data).description ?? "",
                itemsText: (saved ?? data).items.join("\n"),
              }}
              submitLabel="Save changes"
              busyLabel="Saving…"
              busy={busy}
              readOnly={!editable}
              error={error}
              onSubmit={save}
              onCancel={() => router.push("/lists")}
            />
          </Panel>

          {editable ? (
            <Panel title="Danger zone">
              <div className="p-3">
                <p id="delete-explainer" className="text-[13px] text-muted">
                  {data.rule_count > 0
                    ? `${data.rule_count} ${data.rule_count === 1 ? "rule uses" : "rules use"} this list. Remove it from ${data.rule_count === 1 ? "that rule" : "those rules"} before deleting.`
                    : "Deleting removes the list and every item in it. No rule uses it."}
                </p>

                {deleteError ? (
                  <div
                    ref={alertRef}
                    tabIndex={-1}
                    role="alert"
                    className="mt-3 border border-change/40 bg-change/5 px-2.5 py-2 text-[12.5px] text-change focus:outline-2 focus:outline-offset-2 focus:outline-accent"
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
                      tone="danger"
                      disabled
                      aria-describedby="delete-explainer"
                      title="Remove this list from its rules first"
                    >
                      Delete list
                    </Button>
                    <Button onClick={checkAgain} disabled={busy}>
                      Check again
                    </Button>
                  </div>
                ) : confirmingDelete ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button ref={confirmRef} tone="danger" onClick={remove} disabled={busy}>
                      Delete permanently
                    </Button>
                    <Button onClick={cancelDelete} disabled={busy}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    ref={openRef}
                    tone="danger"
                    className="mt-3"
                    onClick={askDelete}
                    disabled={busy}
                  >
                    Delete list
                  </Button>
                )}
              </div>
            </Panel>
          ) : null}
        </div>
      )}
    </PageBody>
  );
}
