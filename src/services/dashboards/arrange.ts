/**
 * Pure operations on a dashboard's ordered query ids.
 *
 * The engine owns the arrangement, but the UI still has to compute the next
 * one before sending it: `PUT /dashboards/{id}` replaces `query_ids` wholesale
 * rather than merging. Keeping that arithmetic here - pure, in one place, and
 * tested - means the components never do list surgery inline.
 */

/** Append unless already present. The same card twice conveys nothing. */
export function withQuery(queryIds: readonly string[], queryId: string): string[] {
  return queryIds.includes(queryId) ? [...queryIds] : [...queryIds, queryId];
}

export function withoutQuery(queryIds: readonly string[], queryId: string): string[] {
  return queryIds.filter((entry) => entry !== queryId);
}

/** Move a query within the board. Out-of-range targets clamp rather than throw. */
export function moved(
  queryIds: readonly string[],
  queryId: string,
  toIndex: number,
): string[] {
  const from = queryIds.indexOf(queryId);
  if (from === -1) return [...queryIds];

  const next = [...queryIds];
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, queryId);
  return next;
}

/** Trimmed, collapsed, length-capped, never empty. */
export function normalizeName(name: string, fallback = "Untitled dashboard"): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 200) : fallback;
}
