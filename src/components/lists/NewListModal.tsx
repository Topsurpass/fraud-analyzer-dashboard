"use client";

import { useState } from "react";
import type { ItemListWrite } from "@/contracts/api";
import { Modal } from "@/components/Modal";
import { createList } from "@/services/api-client";
import { ListForm } from "./ListForm";
import { listErrorMessage } from "./items";

/** What the page needs to confirm a save: which list, and what was kept. */
export interface CreatedList {
  id: string;
  name: string;
  /** Items sent, before duplicates were dropped. */
  received: number;
  kept: number;
}

const EMPTY = { name: "", description: "", itemsText: "" };

/**
 * Create a list without leaving the page.
 *
 * The dialog opens over the lists, and a successful save closes it and hands
 * the result back, so the person lands where they started with the new list in
 * the table rather than on a separate edit page that looks like nothing
 * happened. A failed save keeps it open with the reason, and while a save is in
 * flight it cannot be dismissed, so the answer is never lost behind a closed
 * dialog.
 */
export function NewListModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: CreatedList) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title="New list"
      description="Name it, add its items by pasting or importing a spreadsheet column, and use it in any flag rule."
    >
      {/* Mounted only while open, so the error and the fields start clean. */}
      <NewListBody busy={busy} setBusy={setBusy} onClose={onClose} onCreated={onCreated} />
    </Modal>
  );
}

function NewListBody({
  busy,
  setBusy,
  onClose,
  onCreated,
}: {
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onClose: () => void;
  onCreated: (created: CreatedList) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const create = async (body: ItemListWrite) => {
    setBusy(true);
    setError(null);
    try {
      const saved = await createList(body);
      setBusy(false);
      onCreated({ id: saved.id, name: saved.name, received: saved.received, kept: saved.kept });
      onClose();
    } catch (cause) {
      setError(listErrorMessage(cause, "Could not create the list"));
      setBusy(false);
    }
  };

  return (
    <ListForm
      initial={EMPTY}
      submitLabel="Create list"
      busyLabel="Creating…"
      busy={busy}
      autoFocus
      layout="modal"
      error={error}
      onSubmit={create}
      onCancel={onClose}
    />
  );
}
