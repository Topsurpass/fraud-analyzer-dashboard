"use client";

import { Modal } from "@/components/Modal";
import { SchemaBrowser } from "@/components/SchemaBrowser";
import { Button } from "@/components/ui";

/** Tables and columns, in a dialog, so the page does not spend a column on them. */
export function TablesDialog({
  open,
  onClose,
  connectionId,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  onInsert: (text: string) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Browse tables"
      description="Click a table or a column to put its name into your SQL, at the cursor. Insert as many as you like, then close."
    >
      <div className="max-h-[60dvh] overflow-y-auto p-4">
        <SchemaBrowser connectionId={connectionId} onInsert={onInsert} />
      </div>
      <div className="flex justify-end border-t border-line px-6 py-3">
        <Button type="button" tone="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

/** Asked before throwing away typing, on Cancel. */
export function DiscardDialog({
  open,
  onKeep,
  onDiscard,
  what = "query",
}: {
  open: boolean;
  onKeep: () => void;
  onDiscard: () => void;
  what?: string;
}) {
  return (
    <Modal
      open={open}
      onClose={onKeep}
      title="Discard your changes?"
      description={`You have changes to this ${what} that are not saved. Leaving now loses them.`}
    >
      <div className="flex justify-end gap-2 px-6 py-4">
        <Button type="button" onClick={onKeep} data-autofocus>
          Keep editing
        </Button>
        <Button type="button" tone="danger" onClick={onDiscard}>
          Discard changes
        </Button>
      </div>
    </Modal>
  );
}
