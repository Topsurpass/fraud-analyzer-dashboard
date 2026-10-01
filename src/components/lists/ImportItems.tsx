"use client";

import { useId, useMemo, useRef, useState, type DragEvent } from "react";
import { Button, Select } from "@/components/ui";
import { tallyItems } from "./items";
import {
  ACCEPT,
  ImportError,
  columnNames,
  columnValues,
  defaultColumn,
  looksLikeHeader,
  readSpreadsheet,
  type ParsedSheet,
} from "./spreadsheet";

/**
 * Bring a column of a spreadsheet into a list.
 *
 * Choose or drop a file, pick the sheet and column (and say whether the first
 * row is headings), see exactly what will be added, then confirm. The file is
 * read in the browser and never uploaded: only the confirmed column of text
 * goes on to be saved as items.
 *
 * A preview and a count come before the add because the wrong column is the
 * usual mistake, and "I imported a column of countries" is a worse way to find
 * out than seeing "NG, NG, US" before pressing the button.
 */

const PREVIEW_COUNT = 5;

interface Loaded {
  fileName: string;
  sheets: ParsedSheet[];
}

export function ImportItems({
  onAdd,
  disabled = false,
}: {
  /** The confirmed values. `replace` asks the form to discard what it holds. */
  onAdd: (values: string[], options: { replace: boolean; fileName: string }) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [sheetIndex, setSheetIndex] = useState(0);
  const [hasHeader, setHasHeader] = useState(false);
  const [column, setColumn] = useState(0);
  const [replace, setReplace] = useState(false);

  const sheet = loaded?.sheets[sheetIndex] ?? null;

  const choose = (index: number, sheets: ParsedSheet[]) => {
    const next = sheets[index];
    const header = looksLikeHeader(next.rows);
    setSheetIndex(index);
    setHasHeader(header);
    setColumn(defaultColumn(next.rows, header));
  };

  const load = async (file: File) => {
    setError(null);
    setLoaded(null);
    setReading(true);
    try {
      const sheets = await readSpreadsheet(file);
      setLoaded({ fileName: file.name, sheets });
      choose(0, sheets);
    } catch (cause) {
      setError(
        cause instanceof ImportError
          ? cause.message
          : "That file could not be read. Try saving it as .xlsx or .csv.",
      );
    } finally {
      setReading(false);
      // Let the same file be chosen again after a fix.
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const names = useMemo(
    () => (sheet ? columnNames(sheet.rows, hasHeader) : []),
    [sheet, hasHeader],
  );
  const values = useMemo(
    () => (sheet ? columnValues(sheet.rows, column, hasHeader) : []),
    [sheet, column, hasHeader],
  );
  const tally = useMemo(() => tallyItems(values), [values]);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = event.dataTransfer.files?.[0];
    if (file) void load(file);
  };

  const close = () => {
    setLoaded(null);
    setError(null);
    setReplace(false);
  };

  const add = () => {
    if (!loaded || values.length === 0) return;
    onAdd(values, { replace, fileName: loaded.fileName });
    close();
  };

  return (
    <div className="space-y-2.5">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-dashed px-4 py-3 transition-colors ${
          dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-sunken"
        }`}
      >
        <input
          ref={fileInput}
          id={inputId}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={disabled || reading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void load(file);
          }}
        />
        <Button
          type="button"
          disabled={disabled || reading}
          onClick={() => fileInput.current?.click()}
        >
          {reading ? "Reading…" : "Import from Excel or CSV"}
        </Button>
        <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-muted">
          Choose or drop an <span className="font-medium text-secondary">.xlsx</span>,{" "}
          <span className="font-medium text-secondary">.csv</span>,{" "}
          <span className="font-medium text-secondary">.tsv</span> or{" "}
          <span className="font-medium text-secondary">.txt</span> file. It is read in your
          browser; nothing is uploaded until you save.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-[var(--radius-sm)] border border-alert/30 bg-alert/8 px-3 py-2 text-[12.5px] leading-relaxed text-ink"
        >
          {error}
        </p>
      ) : null}

      {loaded && sheet ? (
        <section
          aria-label={`Import from ${loaded.fileName}`}
          className="space-y-3 rounded-[var(--radius)] border border-line bg-surface p-4 shadow-sm"
        >
          <p className="text-[13px] font-medium text-ink">
            <span className="text-muted">Importing from</span> {loaded.fileName}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {loaded.sheets.length > 1 ? (
              <label className="block space-y-1.5 text-[12.5px] font-medium">
                Sheet
                <Select
                  value={sheetIndex}
                  onChange={(event) => choose(Number(event.target.value), loaded.sheets)}
                >
                  {loaded.sheets.map((candidate, index) => (
                    <option key={index} value={index}>
                      {candidate.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}

            <label className="block space-y-1.5 text-[12.5px] font-medium">
              Column
              <Select value={column} onChange={(event) => setColumn(Number(event.target.value))}>
                {names.map((name, index) => (
                  <option key={index} value={index}>
                    {name}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <label className="flex items-center gap-2 text-[13px] text-secondary">
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(event) => {
                const next = event.target.checked;
                setHasHeader(next);
                setColumn(defaultColumn(sheet.rows, next));
              }}
              className="size-4 accent-[var(--accent)]"
            />
            First row is column headings
          </label>

          <div aria-live="polite" className="space-y-2">
            {values.length === 0 ? (
              <p className="text-[13px] text-muted">This column has no values.</p>
            ) : (
              <>
                <p className="tnum text-[13px] text-secondary">
                  <span className="font-semibold text-ink">{tally.kept.toLocaleString()}</span>{" "}
                  {tally.kept === 1 ? "item" : "items"} to add
                  {tally.duplicates > 0
                    ? `, ${tally.duplicates.toLocaleString()} ${tally.duplicates === 1 ? "duplicate" : "duplicates"} in the file will be dropped`
                    : ""}
                </p>
                <ul aria-label="Preview" className="flex flex-wrap gap-1.5">
                  {values.slice(0, PREVIEW_COUNT).map((value, index) => (
                    <li
                      key={index}
                      className="mono max-w-[16rem] truncate rounded-md bg-raised px-2 py-1 text-[12.5px] text-ink"
                    >
                      {value}
                    </li>
                  ))}
                  {values.length > PREVIEW_COUNT ? (
                    <li className="px-1 py-1 text-[12.5px] text-muted">
                      +{(values.length - PREVIEW_COUNT).toLocaleString()} more
                    </li>
                  ) : null}
                </ul>
              </>
            )}
          </div>

          <label className="flex items-center gap-2 text-[13px] text-secondary">
            <input
              type="checkbox"
              checked={replace}
              onChange={(event) => setReplace(event.target.checked)}
              className="size-4 accent-[var(--accent)]"
            />
            Replace the items already in the box instead of adding to them
          </label>

          <div className="flex items-center gap-2">
            <Button type="button" tone="primary" disabled={values.length === 0} onClick={add}>
              {values.length === 0
                ? "Add items"
                : `Add ${tally.kept.toLocaleString()} ${tally.kept === 1 ? "item" : "items"}`}
            </Button>
            <Button type="button" onClick={close}>
              Cancel
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
