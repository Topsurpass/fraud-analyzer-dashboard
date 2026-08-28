"use client";

import { useRef } from "react";
import { useVirtualRows } from "@/lib/useVirtualRows";

/**
 * The list surface both admin screens are built on.
 *
 * Windowed above `VIRTUALISE_ABOVE` rows for the same reason `TableView` is:
 * the audit log is append-only and nothing ever prunes it, so it is the one
 * table in this app whose row count only goes up. At a few thousand entries an
 * unwindowed render puts a `<tr>` per entry in the DOM and the cost lands on
 * the main thread every time a filter changes.
 *
 * Rows are a fixed height by contract, which is what makes the arithmetic in
 * `useVirtualRows` correct. Any cell that could wrap has to truncate instead -
 * a single row growing to two lines puts every offset below it out by 30px and
 * the list starts drifting as you scroll.
 */
const ROW_HEIGHT = 40;
const VIRTUALISE_ABOVE = 60;

export interface RecordColumn<Row> {
	key: string;
	header: string;
	/** Fixed track for the CSS grid. Every row uses the same one. */
	width: string;
	cell: (row: Row) => React.ReactNode;
	/** Right-align and set tabular figures. For counts, dates and durations. */
	numeric?: boolean;
	/** Hidden below `md`. Use for anything that is context rather than identity. */
	secondary?: boolean;
}

export function RecordTable<Row>({
	rows,
	columns,
	rowKey,
	caption,
	empty,
	rowClassName,
}: {
	rows: readonly Row[];
	columns: readonly RecordColumn<Row>[];
	rowKey: (row: Row) => string;
	/** Announced to screen readers as the table's purpose. Not shown. */
	caption: string;
	empty: React.ReactNode;
	rowClassName?: (row: Row) => string;
}) {
	const scrollRef = useRef<HTMLDivElement | null>(null);

	const virtualise = rows.length > VIRTUALISE_ABOVE;
	const window = useVirtualRows(scrollRef, virtualise ? rows.length : 0, ROW_HEIGHT);
	const first = virtualise ? window.start : 0;
	const last = virtualise ? window.end : rows.length;

	if (rows.length === 0) {
		return <div className="px-4 py-10">{empty}</div>;
	}

	const template = columns.map((column) => column.width).join(" ");

	return (
		<div className="flex min-h-0 flex-col">
			{/* Outside the scroller so it stays put; `sticky` inside a virtualised
			    body would sit on a spacer div and scroll away with it. */}
			<div
				role="presentation"
				className="grid shrink-0 gap-3 border-b border-line bg-sunken px-3.5 py-2"
				style={{ gridTemplateColumns: template }}
			>
				{columns.map((column) => (
					<span
						key={column.key}
						className={`t-eyebrow truncate ${column.numeric ? "text-right" : ""} ${
							column.secondary ? "hidden md:block" : ""
						}`}
					>
						{column.header}
					</span>
				))}
			</div>

			<div
				ref={scrollRef}
				tabIndex={0}
				role="table"
				aria-label={caption}
				aria-rowcount={rows.length}
				className="min-h-0 flex-1 overflow-auto"
			>
				{virtualise ? <div style={{ height: window.padTop }} /> : null}

				{rows.slice(first, last).map((row, offset) => (
					<div
						key={rowKey(row)}
						role="row"
						aria-rowindex={first + offset + 1}
						className={`grid items-center gap-3 border-b border-line/60 px-3.5 text-[12.5px] transition-colors hover:bg-raised ${
							rowClassName?.(row) ?? ""
						}`}
						style={{ gridTemplateColumns: template, height: ROW_HEIGHT }}
					>
						{columns.map((column) => (
							<div
								key={column.key}
								role="cell"
								className={`min-w-0 truncate ${
									column.numeric ? "tnum text-right text-[11.5px] text-muted" : ""
								} ${column.secondary ? "hidden md:block" : ""}`}
							>
								{column.cell(row)}
							</div>
						))}
					</div>
				))}

				{virtualise ? <div style={{ height: window.padBottom }} /> : null}
			</div>
		</div>
	);
}

/**
 * The count line under a filtered list. Says what was hidden, not just what is
 * shown - "12 accounts" beside a search box leaves you wondering whether that is
 * all of them.
 *
 * The plural is passed in rather than derived. Every "add an s" helper meets
 * "entrys" eventually, and this app already has the word.
 */
export function ResultCount({
	shown,
	total,
	noun,
	plural,
}: {
	shown: number;
	total: number;
	noun: string;
	plural: string;
}) {
	const word = total === 1 ? noun : plural;
	return (
		<p className="tnum text-[11px] text-muted" aria-live="polite">
			{shown === total ? `${total} ${word}` : `${shown} of ${total} ${word} match this filter`}
		</p>
	);
}
