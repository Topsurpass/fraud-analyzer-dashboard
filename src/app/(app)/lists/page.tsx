"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageBody } from "@/components/PageBody";
import { RecordTable, ResultCount, type RecordColumn } from "@/components/admin/RecordTable";
import { mayEditList } from "@/components/lists/items";
import { Button, EmptyState, ErrorState, Input, LinkButton, Panel } from "@/components/ui";
import type { ItemListSummary } from "@/contracts/api";
import { useLists } from "@/lib/ListsContext";
import { useAuth } from "@/services/auth/AuthContext";
import { formatRelative } from "@/services/format";
import { useNow } from "@/lib/useNow";

const CRUMBS = [{ label: "Lists" }];

export default function ListsPage() {
	const { user, can } = useAuth();
	const { lists, error, initial, loading, reload } = useLists();
	const now = useNow(30_000);
	const mayCreate = can("lists.write");
	const [filter, setFilter] = useState("");

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
					<LinkButton href="/lists/new" tone="primary">
						New list
					</LinkButton>
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
								empty={
									lists.length === 0 ? (
										<EmptyState
											title="No lists yet"
											body="Paste a watchlist once, name it, and use it in as many flag rules as you like."
											action={
												mayCreate ? (
													<LinkButton href="/lists/new" tone="primary">
														Create a list
													</LinkButton>
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
		</PageBody>
	);
}
