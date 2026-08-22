"use client";

import { useCallback, useState } from "react";
import type { ColumnInfo } from "@/contracts/api";
import { listColumns, listTables } from "@/services/api-client";
import { useResource } from "@/lib/useResource";
import { Panel } from "./ui";

/**
 * The target database's tables, expandable to their columns.
 *
 * Columns are fetched per table on first expand rather than up front: a
 * warehouse can hold hundreds of tables and the analyst opens two of them.
 *
 * When `onInsert` is supplied every name becomes a button that writes into the
 * editor, which is what stops the most common cause of a failed query - a
 * column name typed from memory.
 */
export function SchemaBrowser({
  connectionId,
  onInsert,
  className,
}: {
  connectionId: string;
  onInsert?: (text: string) => void;
  className?: string;
}) {
  const load = useCallback(
    (signal: AbortSignal) => listTables(connectionId, { signal }),
    [connectionId],
  );
  const tables = useResource(load);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Panel
      title="Schema"
      className={className}
      actions={
        tables.data ? (
          <span className="tnum text-[11px] text-muted">{tables.data.tables.length}</span>
        ) : null
      }
    >
      <div className="max-h-80 overflow-y-auto p-2">
        {tables.error ? (
          <p className="px-1 text-[12px] text-muted">{tables.error.displayMessage}</p>
        ) : tables.initial ? (
          <ul className="skeleton-sweep space-y-1.5 p-1">
            {[0, 1, 2, 3, 4].map((index) => (
              <li key={index} className="h-2.5 bg-line" style={{ width: `${70 - index * 8}%` }} />
            ))}
          </ul>
        ) : (tables.data?.tables ?? []).length === 0 ? (
          <p className="px-1 text-[12px] text-muted">No tables visible to this user.</p>
        ) : (
          <ul>
            {tables.data?.tables.map((table) => (
              <TableRow
                key={table.name}
                connectionId={connectionId}
                name={table.name}
                kind={table.kind}
                open={open === table.name}
                onToggle={() => setOpen((current) => (current === table.name ? null : table.name))}
                onInsert={onInsert}
              />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function TableRow({
  connectionId,
  name,
  kind,
  open,
  onToggle,
  onInsert,
}: {
  connectionId: string;
  name: string;
  kind: string;
  open: boolean;
  onToggle: () => void;
  onInsert?: (text: string) => void;
}) {
  return (
    <li>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-1 text-left transition-colors hover:text-ink"
        >
          <span
            aria-hidden="true"
            className="tnum w-2 shrink-0 text-[9px] text-muted"
          >
            {open ? "−" : "+"}
          </span>
          <span className="tnum truncate text-[12px]">{name}</span>
          <span className="ml-auto shrink-0 text-[9px] tracking-wide text-muted uppercase">
            {kind}
          </span>
        </button>
        {onInsert ? (
          <button
            type="button"
            onClick={() => onInsert(name)}
            aria-label={`Insert ${name} into the query`}
            title="Insert into the query"
            className="shrink-0 px-1 text-[11px] text-muted transition-colors hover:text-live"
          >
            <span aria-hidden="true">↵</span>
          </button>
        ) : null}
      </div>

      {open ? <Columns connectionId={connectionId} table={name} onInsert={onInsert} /> : null}
    </li>
  );
}

function Columns({
  connectionId,
  table,
  onInsert,
}: {
  connectionId: string;
  table: string;
  onInsert?: (text: string) => void;
}) {
  const load = useCallback(
    (signal: AbortSignal) => listColumns(connectionId, table, { signal }),
    [connectionId, table],
  );
  const columns = useResource(load);

  if (columns.error) {
    return (
      <p className="py-1 pl-4 text-[11px] text-muted">{columns.error.displayMessage}</p>
    );
  }

  if (columns.initial) {
    return (
      <ul className="skeleton-sweep space-y-1 py-1 pl-4">
        {[0, 1, 2].map((index) => (
          <li key={index} className="h-2 bg-line" style={{ width: `${60 - index * 10}%` }} />
        ))}
      </ul>
    );
  }

  return (
    <ul className="border-l border-line py-0.5 pl-3 ml-2">
      {(columns.data?.columns ?? []).map((column) => (
        <li key={column.name}>
          <ColumnRow column={column} onInsert={onInsert} />
        </li>
      ))}
    </ul>
  );
}

function ColumnRow({
  column,
  onInsert,
}: {
  column: ColumnInfo;
  onInsert?: (text: string) => void;
}) {
  // A primary key is not-null by definition, so saying both is noise.
  const meta = [
    column.type,
    column.primary_key ? "pk" : null,
    column.primary_key || column.nullable ? null : "not null",
  ]
    .filter(Boolean)
    .join(" · ");

  const content = (
    <>
      <span className="tnum truncate text-[11px]">{column.name}</span>
      <span className="tnum ml-auto shrink-0 text-[9px] text-muted">{meta}</span>
    </>
  );

  if (!onInsert) {
    return <div className="flex items-center gap-2 px-1 py-0.5">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onInsert(column.name)}
      title={`Insert ${column.name}`}
      className="flex w-full items-center gap-2 px-1 py-0.5 text-left text-muted transition-colors hover:text-live"
    >
      {content}
    </button>
  );
}
