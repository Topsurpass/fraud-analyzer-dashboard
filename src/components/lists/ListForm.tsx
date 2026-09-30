"use client";

import { useMemo, useState } from "react";
import type { ItemListWrite } from "@/contracts/api";
import { Button, Field, Input, Textarea } from "@/components/ui";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_ITEM_LENGTH,
  MAX_NAME_LENGTH,
  parseItems,
  tallyItems,
} from "./items";

/**
 * Name, description and items for one list.
 *
 * Items are pasted rather than added one at a time: the reason a list exists
 * is that a watchlist has hundreds of entries. The count under the box updates
 * as you type and says how many duplicates the engine will drop, so a
 * spreadsheet paste with repeats is not a surprise after saving.
 */
export interface ListFormValues {
  name: string;
  description: string;
  /** Items as text, one per line. */
  itemsText: string;
}

export function ListForm({
  initial,
  submitLabel,
  busyLabel,
  busy,
  readOnly = false,
  autoFocus = false,
  version,
  error,
  onSubmit,
  onCancel,
}: {
  initial: ListFormValues;
  submitLabel: string;
  busyLabel: string;
  busy: boolean;
  /** Everyone can read a list; only its creator or an admin can change it. */
  readOnly?: boolean;
  /** Focus the name on mount. Only the new-list page wants that: on an edit page the form remounts after every save and would pull focus from wherever it was. */
  autoFocus?: boolean;
  /**
   * Changes when the fields should be replaced from `initial` (after a save,
   * so the box shows what the engine kept). Replacing in place, rather than
   * remounting the form, keeps whatever had keyboard focus.
   */
  version?: string;
  error: string | null;
  onSubmit: (body: ItemListWrite) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [itemsText, setItemsText] = useState(initial.itemsText);
  const [touched, setTouched] = useState(false);
  const [seenVersion, setSeenVersion] = useState(version);
  if (version !== seenVersion) {
    setSeenVersion(version);
    setName(initial.name);
    setDescription(initial.description);
    setItemsText(initial.itemsText);
    setTouched(false);
  }

  const items = useMemo(() => parseItems(itemsText), [itemsText]);
  const tally = useMemo(() => tallyItems(items), [items]);

  const nameProblem = !name.trim()
    ? "A name is required."
    : name.trim().length > MAX_NAME_LENGTH
      ? `Names are at most ${MAX_NAME_LENGTH} characters.`
      : null;
  const descriptionProblem =
    description.length > MAX_DESCRIPTION_LENGTH
      ? `Descriptions are at most ${MAX_DESCRIPTION_LENGTH} characters.`
      : null;
  const itemsProblem =
    items.length === 0
      ? "Add at least one item."
      : tally.tooLong > 0
        ? `${tally.tooLong} ${tally.tooLong === 1 ? "item is" : "items are"} over ${MAX_ITEM_LENGTH} characters.`
        : null;

  const invalid = Boolean(nameProblem || descriptionProblem || itemsProblem);

  return (
    <form
      className="space-y-3 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (readOnly || busy || invalid) return;
        onSubmit({
          name: name.trim(),
          description: description.trim() || null,
          items,
        });
      }}
    >
      <Field
        label="Name"
        htmlFor="list-name"
        error={touched ? nameProblem : null}
        hint="Rules show this name, so make it say what the list is."
      >
        <Input
          id="list-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Blocked terminals"
          disabled={readOnly}
          autoFocus={autoFocus && !readOnly}
        />
      </Field>

      <Field
        label="Description"
        htmlFor="list-description"
        error={touched ? descriptionProblem : null}
        hint="Optional. Where the entries came from, or who keeps them current."
      >
        <Textarea
          id="list-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          placeholder="Terminals pulled after the August chargeback wave."
          disabled={readOnly}
        />
      </Field>

      <Field
        label="Items"
        htmlFor="list-items"
        error={touched ? itemsProblem : null}
        hint="One per line. On a single line, commas separate items; once you use new lines, commas stay part of the item. Case and spacing are ignored, and 2.0 matches 2."
      >
        <Textarea
          id="list-items"
          value={itemsText}
          onChange={(event) => setItemsText(event.target.value)}
          rows={12}
          placeholder={"T-1041\nT-1042\nT-2207"}
          spellCheck={false}
          disabled={readOnly}
          className="font-mono text-[12.5px]"
        />
      </Field>

      <p className="tnum text-[12.5px] text-muted" aria-live="polite">
        {tally.kept} {tally.kept === 1 ? "item" : "items"}
        {tally.duplicates > 0
          ? `, ${tally.duplicates} ${tally.duplicates === 1 ? "duplicate" : "duplicates"} will be dropped`
          : ""}
      </p>

      {error ? (
        <p
          role="alert"
          className="border border-change/40 bg-change/5 px-2.5 py-1.5 text-[12.5px] text-change"
        >
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        {readOnly ? null : (
          /* Not `disabled`: a focused button that becomes disabled drops
             keyboard focus to the page, and this one is pressed then held
             through the save. The submit handler already ignores a busy form. */
          <Button
            type="submit"
            tone="primary"
            aria-disabled={busy}
            className={busy ? "opacity-40" : undefined}
          >
            {busy ? busyLabel : submitLabel}
          </Button>
        )}
        <Button type="button" onClick={onCancel}>
          {readOnly ? "Back" : "Cancel"}
        </Button>
      </div>
    </form>
  );
}
