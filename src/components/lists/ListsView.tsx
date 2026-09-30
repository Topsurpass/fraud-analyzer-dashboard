"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageBody } from "@/components/PageBody";
import { RecordTable, ResultCount, type RecordColumn } from "@/components/admin/RecordTable";
import { mayEditList } from "@/components/lists/items";
import { NewListModal, type CreatedList } from "@/components/lists/NewListModal";
import { Button, EmptyState, ErrorState, Input, LinkButton, Panel } from "@/components/ui";
import type { ItemListSummary } from "@/contracts/api";
import { useLists } from "@/lib/ListsContext";
import { useAuth } from "@/services/auth/AuthContext";
import { formatRelative } from "@/services/format";
import { useNow } from "@/lib/useNow";

const CRUMBS = [{ label: "Lists" }];

/** How long the new row stays marked, long enough to find it in a long table. */
const HIGHLIGHT_MS = 5000;

/**
 * The lists table, and the dialog that adds to it.
 *
 * Creating a list opens a dialog over this page rather than navigating away:
 * on save it closes, the table refreshes, and a notice says what was kept (a
 * paste of 500 lines that lost 40 to duplicates should not be a surprise) with
 * the new row marked for a few seconds. `/lists/new` still works as a link: it
 * lands here with the dialog already open.
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
	const [created, setCreated] = useState<CreatedList | null>(null);
	const [highlight, setHighlight] = useState<string | null>(null);

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
							href={`/lists/${list.id}`}
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
						<LinkButton href={`/lists/${list.id}`} tone="ghost">
							{mayEditList(list, user) ? "Edit" : "View"}
						</LinkButton>
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

						{created ? (
							<p
								role="status"
								className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-live/25 bg-live/10 px-5 py-2.5 text-[13px] text-ink"
							>
								<span>
									<span className="font-semibold text-live">Created</span> &ldquo;{created.name}
									&rdquo; with {created.kept.toLocaleString()}{" "}
									{created.kept === 1 ? "item" : "items"}
									{created.received > created.kept
										? `. ${(created.received - created.kept).toLocaleString()} ${
												created.received - created.kept === 1 ? "duplicate was" : "duplicates were"
											} dropped`
										: ""}
									.
								</span>
								<Link
									href={`/lists/${created.id}`}
									className="font-medium text-accent hover:underline"
								>
									Open list
								</Link>
								<button
									type="button"
									onClick={() => setCreated(null)}
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
					setCreated(result);
					setHighlight(result.id);
					// The table is fed by a shared context, so the new row appears
					// once it refetches.
					reload();
				}}
			/>
		</PageBody>
	);
}
