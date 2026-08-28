import { AUDIT_ACTION_LABELS, ROLE_LABELS, type AuditEntryRead, type UserRole } from "@/contracts/api";

/**
 * Turning one audit row into a sentence.
 *
 * Pure, and separate from the page, because this is the part somebody will read
 * months from now to reconstruct what happened - which makes it worth testing
 * directly rather than through a rendered table.
 *
 * The engine's `detail` is a free-form JSON column, so this treats every field
 * in it as optional. A row written by a future version of the engine with a
 * shape this does not recognise still renders: it falls back to the action
 * label, which is always right, rather than to "undefined" or an empty cell.
 * An audit log that hides an entry it cannot parse is worse than useless.
 */
function text(detail: Record<string, unknown> | null, key: string): string | null {
	const value = detail?.[key];
	return typeof value === "string" && value ? value : null;
}

function roleName(raw: string | null): string | null {
	if (!raw) return null;
	return ROLE_LABELS[raw as UserRole] ?? raw;
}

/** Who the entry is about, as an email when the engine recorded one. */
export function auditSubject(entry: AuditEntryRead): string {
	return text(entry.detail, "email") ?? `${entry.target_type} ${entry.target_id}`;
}

/**
 * What happened, in one line, without repeating the actor.
 *
 * The actor already has its own column, so a sentence that opened with it would
 * say the same name twice on every row.
 */
export function describeAuditEntry(entry: AuditEntryRead): string {
	const subject = auditSubject(entry);

	switch (entry.action) {
		case "user_created": {
			const role = roleName(text(entry.detail, "role"));
			return role ? `Opened ${subject}'s account as ${role}` : `Opened ${subject}'s account`;
		}
		case "user_role_changed": {
			const from = roleName(text(entry.detail, "from_role"));
			const to = roleName(text(entry.detail, "to_role"));
			if (from && to) return `Changed ${subject} from ${from} to ${to}`;
			if (to) return `Changed ${subject} to ${to}`;
			return `Changed ${subject}'s role`;
		}
		case "user_deactivated":
			return `Deactivated ${subject}`;
		case "user_reactivated":
			return `Reactivated ${subject}`;
		case "user_password_reset":
			return `Issued ${subject} a new temporary password`;
		default:
			// An action this build has never heard of. The label map will not have
			// it either, so fall back to the raw value: a reader can still search
			// the engine for it, which is more than a blank cell offers.
			return AUDIT_ACTION_LABELS[entry.action] ?? String(entry.action);
	}
}

/** Substring over everything a person would think to type. */
export function matchesAuditQuery(entry: AuditEntryRead, raw: string): boolean {
	const query = raw.trim().toLowerCase();
	if (!query) return true;
	return (
		entry.actor_email.toLowerCase().includes(query) ||
		describeAuditEntry(entry).toLowerCase().includes(query) ||
		auditSubject(entry).toLowerCase().includes(query)
	);
}
