"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageBody } from "@/components/PageBody";
import { RecordTable, ResultCount, type RecordColumn } from "@/components/admin/RecordTable";
import { mayEditList } from "@/components/lists/items";
import { EditListModal, type ListChange } from "@/components/lists/EditListModal";
import { NewListModal, type CreatedList } from "@/components/lists/NewListModal";
import { Button, EmptyState, ErrorState, Input, Panel } from "@/components/ui";
import type { ItemListSummary } from "@/contracts/api";
import { useLists } from "@/lib/ListsContext";
import { useAuth } from "@/services/auth/AuthContext";
import { formatRelative } from "@/services/format";
import { useNow } from "@/lib/useNow";

const CRUMBS = [{ label: "Lists" }];

/** How long the new row stays marked, long enough to find it in a long table. */
const HIGHLIGHT_MS = 5000;

/** What the banner above the table is confirming. */
type Notice =
	| ({ kind: "created" } & CreatedList)
	| ListChange;

/** A plain left click, which the page takes over; anything else (a new tab, a
 *  copied link) is left to the browser so the link still works as a link. */
function isPlainClick(event: MouseEvent): boolean {
	return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * The lists table, and the dialogs that change it.
 *
 * Creating, editing and deleting a list all happen in a dialog over this page
 * rather than on a page of their own: on save the dialog closes, the table
 * refreshes, and a banner says what happened (a paste of 500 lines that lost 40
 * to duplicates should not be a surprise) with the row marked for a few
 * seconds. `/lists/new` and `/lists/<id>` still work as links: they land here
 * with the right dialog already open.
 */
export function ListsView() {
	const { user, can } = useAuth();
	const { lists, error, initial, loading, reload } = useLists();
	const now = useNow(30_000);
	const mayCreate = can("lists.write");
	const [filter, setFilter] = useState("");
	const router = useRouter();
	const params = useSearchParams();
	// `?new` is how the old /lists/new link arrives; after that the dialog is
	// ordinary local state.
	const [creating, setCreating] = useState(() => params.has("new"));
	// `?open=<id>` is how the old /lists/<id> link arrives.
	const [editingId, setEditingId] = useState<string | null>(() => params.get("open"));
	const [notice, setNotice] = useState<Notice | null>(null);
	const [highlight, setHighlight] = useState<string | null>(null);

	const closeEditing = () => {
		setEditingId(null);
		if (params.has("open")) router.replace("/lists");
	};

	const openList = (event: MouseEvent, id: string) => {
		if (!isPlainClick(event)) return;
		event.preventDefault();
		setEditingId(id);
	};

	const closeCreating = () => {
		setCreating(false);
		// Drop the flag so a reload does not reopen a dialog that was dismissed.
		if (params.has("new")) router.replace("/lists");
	};

	useEffect(() => {
		if (!highlight) return;
		const timer = window.setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
		return () => window.clearTimeout(timer);
	}, [highlight]);

	const shown = useMemo(() => {
		const needle = filter.trim().toLowerCase();
		if (!needle) return lists;
		return lists.filter(
			(list) =>
				list.name.toLowerCase().includes(needle) ||
				(list.description ?? "").toLowerCase().includes(needle),
		);
	}, [lists, filter]);

	const columns = useMemo<RecordColumn<ItemListSummary>[]>(
		() => [
			{
				key: "name",
				header: "List",
				width: "minmax(0,2.4fr)",
				cell: (list) => (
					<div className="min-w-0">
						<Link
							href={`/lists?open=${list.id}`}
							onClick={(event) => openList(event, list.id)}
							className="block truncate font-medium text-ink hover:text-accent"
						>
							{list.name}
						</Link>
						<span className="block truncate text-[12.5px] text-muted">
							{list.description || "No description"}
						</span>
					</div>
				),
			},
			{
				key: "items",
				header: "Items",
				width: "96px",
				numeric: true,
				cell: (list) => list.item_count.toLocaleString(),
			},
			{
				key: "rules",
				header: "Used by rules",
				width: "132px",
				numeric: true,
				secondary: true,
				cell: (list) => list.rule_count.toLocaleString(),
			},
			{
				key: "updated",
				header: "Updated",
				width: "112px",
				numeric: true,
				secondary: true,
				cell: (list) => (
					<span title={list.updated_at}>{formatRelative(list.updated_at, now)}</span>
				),
			},
			{
				key: "actions",
				header: "",
				width: "88px",
				cell: (list) => (
					<div className="flex items-center justify-end">
						<Button tone="ghost" onClick={() => setEditingId(list.id)}>
							{mayEditList(list, user) ? "Edit" : "View"}
						</Button>
					</div>
				),
			},
		],
		[now, user],
	);

	return (
		<PageBody
			crumbs={CRUMBS}
			actions={
				mayCreate ? (
					<Button tone="primary" onClick={() => setCreating(true)}>
						New list
					</Button>
				) : undefined
			}
		>
			<div className="mx-auto flex flex-col gap-4">
				{error && lists.length === 0 && !loading ? (
					<ErrorState
						title="Could not load the lists"
						message={error.displayMessage}
						onRetry={reload}
					/>
				) : (
					<Panel
						title="Lists"
						actions={
							<Input
								type="search"
								value={filter}
								onChange={(event) => setFilter(event.target.value)}
								placeholder="Search lists"
								aria-label="Filter lists"
								className="w-[260px] shrink-0"
							/>
						}
					>
						<p className="border-b border-line px-5 py-3 text-[12.5px] leading-relaxed text-muted">
							A list is a named set of values, such as account numbers or terminal ids.
							Add a condition like &ldquo;terminal is in list&rdquo; to a flag rule and
							edit the list later without touching the rule.
						</p>

						{notice ? (
							<p
								role="status"
								className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-live/25 bg-live/10 px-5 py-2.5 text-[13px] text-ink"
							>
								<span>{noticeText(notice)}</span>
								{notice.kind === "created" ? (
									<Link
										href={`/lists?open=${notice.id}`}
										onClick={(event) => openList(event, notice.id)}
										className="font-medium text-accent hover:underline"
									>
										Open list
									</Link>
								) : null}
								<button
									type="button"
									onClick={() => setNotice(null)}
									className="ml-auto text-[12.5px] text-muted hover:text-ink"
								>
									Dismiss
								</button>
							</p>
						) : null}

						{error && lists.length > 0 ? (
							<p
								role="alert"
								className="border-b border-line bg-change/5 px-5 py-2 text-[12.5px] text-change"
							>
								Could not refresh the lists: {error.displayMessage}{" "}
								<button type="button" onClick={reload} className="font-medium underline">
									Retry
								</button>
							</p>
						) : null}

						{initial ? (
							<div className="skeleton-sweep space-y-2 p-4">
								{[0, 1, 2].map((row) => (
									<div key={row} className="h-6 bg-line" />
								))}
							</div>
						) : (
							<RecordTable
								rows={shown}
								columns={columns}
								rowKey={(list) => list.id}
								caption="Named lists available to flag rules"
								rowClassName={(list) => (list.id === highlight ? "bg-accent-soft" : "")}
								empty={
									lists.length === 0 ? (
										<EmptyState
											title="No lists yet"
											body="Paste a watchlist once, name it, and use it in as many flag rules as you like."
											action={
												mayCreate ? (
													<Button tone="primary" onClick={() => setCreating(true)}>
														Create a list
													</Button>
												) : undefined
											}
										/>
									) : (
										<EmptyState
											title="No lists match"
											body="Try a different name, or clear the filter."
											action={<Button onClick={() => setFilter("")}>Clear filter</Button>}
										/>
									)
								}
							/>
						)}

						<div className="flex items-center gap-3 border-t border-line px-5 py-3">
							<ResultCount
								shown={shown.length}
								total={lists.length}
								noun="list"
								plural="lists"
							/>
							{loading && !initial ? (
								<span className="ml-auto text-[12.5px] text-muted">refreshing</span>
							) : null}
						</div>
					</Panel>
				)}
			</div>

			<NewListModal
				open={creating}
				onClose={closeCreating}
				onCreated={(result) => {
					setNotice({ kind: "created", ...result });
					setHighlight(result.id);
					// The table is fed by a shared context, so the new row appears
					// once it refetches.
					reload();
				}}
			/>

			<EditListModal
				id={editingId}
				title={lists.find((list) => list.id === editingId)?.name}
				onClose={closeEditing}
				onChanged={(change) => {
					setNotice(change);
					// A deleted list has no row left to mark.
					setHighlight(change.kind === "deleted" ? null : change.id);
					reload();
				}}
			/>
		</PageBody>
	);
}

/** The sentence for a banner. Names the list, and what happened to its items. */
function noticeText(notice: Notice): React.ReactNode {
	const items = (count: number) => `${count.toLocaleString()} ${count === 1 ? "item" : "items"}`;
	const dropped = (count: number) =>
		`${count.toLocaleString()} ${count === 1 ? "duplicate was" : "duplicates were"} dropped`;

	switch (notice.kind) {
		case "created": {
			const extra = notice.received - notice.kept;
			return (
				<>
					<span className="font-semibold text-live">Created</span> &ldquo;{notice.name}&rdquo; with{" "}
					{items(notice.kept)}
					{extra > 0 ? `. ${dropped(extra)}` : ""}.
				</>
			);
		}
		case "saved":
			return (
				<>
					<span className="font-semibold text-live">Saved</span> &ldquo;{notice.name}&rdquo;.{" "}
					{items(notice.kept)} kept
					{notice.duplicatesDropped > 0 ? `, ${dropped(notice.duplicatesDropped)}` : ""}. Rules that
					use this list pick up the change on their next poll.
				</>
			);
		case "deleted":
			return (
				<>
					<span className="font-semibold text-live">Deleted</span> &ldquo;{notice.name}&rdquo;.
				</>
			);
	}
}
