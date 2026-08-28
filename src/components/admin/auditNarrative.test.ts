import { describe, expect, it } from "vitest";
import type { AuditEntryRead } from "@/contracts/api";
import { auditSubject, describeAuditEntry, matchesAuditQuery } from "./auditNarrative";

function entry(over: Partial<AuditEntryRead> = {}): AuditEntryRead {
	return {
		id: "a1",
		actor_id: "u2",
		actor_email: "grace@navy.example",
		action: "user_created",
		target_type: "user",
		target_id: "u1",
		detail: { email: "ada@example.com", role: "analyst" },
		created_at: "2026-08-27T09:00:00Z",
		...over,
	};
}

describe("describeAuditEntry", () => {
	it("says who the account belongs to and what role it opened as", () => {
		expect(describeAuditEntry(entry())).toBe("Opened ada@example.com's account as Analyst");
	});

	it("spells out a role change in both directions", () => {
		const changed = entry({
			action: "user_role_changed",
			detail: { email: "ada@example.com", from_role: "analyst", to_role: "admin" },
		});
		expect(describeAuditEntry(changed)).toBe(
			"Changed ada@example.com from Analyst to Administrator",
		);
	});

	it("covers deactivation, reactivation and a password reset", () => {
		const detail = { email: "ada@example.com" };
		expect(describeAuditEntry(entry({ action: "user_deactivated", detail }))).toBe(
			"Deactivated ada@example.com",
		);
		expect(describeAuditEntry(entry({ action: "user_reactivated", detail }))).toBe(
			"Reactivated ada@example.com",
		);
		expect(describeAuditEntry(entry({ action: "user_password_reset", detail }))).toBe(
			"Issued ada@example.com a new temporary password",
		);
	});

	it("never opens with the actor, which has its own column", () => {
		expect(describeAuditEntry(entry())).not.toContain("grace@navy.example");
	});
});

describe("an entry this build does not fully understand", () => {
	/*
	 * `detail` is a free-form JSON column on the engine and the action set can
	 * grow. An audit log that hides an entry it cannot parse, or renders
	 * "undefined" into it, is worse than useless - the whole point is that it can
	 * be read months later to reconstruct what happened.
	 */
	it("falls back to the target when the detail carries no email", () => {
		const sparse = entry({ detail: null });
		expect(auditSubject(sparse)).toBe("user u1");
		expect(describeAuditEntry(sparse)).toBe("Opened user u1's account");
	});

	it("ignores a detail field of the wrong type", () => {
		const wrong = entry({ detail: { email: 42, role: null } as unknown as Record<string, unknown> });
		expect(describeAuditEntry(wrong)).toBe("Opened user u1's account");
	});

	it("renders a partial role change rather than dropping the row", () => {
		const partial = entry({
			action: "user_role_changed",
			detail: { email: "ada@example.com", to_role: "admin" },
		});
		expect(describeAuditEntry(partial)).toBe("Changed ada@example.com to Administrator");
	});

	it("passes an unrecognised role value straight through", () => {
		// A role added to the engine before this build knows its label. The raw
		// value is still something a reader can search the engine for.
		const future = entry({ detail: { email: "ada@example.com", role: "supervisor" } });
		expect(describeAuditEntry(future)).toBe("Opened ada@example.com's account as supervisor");
	});

	it("names an action it has never heard of instead of rendering nothing", () => {
		const future = entry({ action: "connection_deleted" as AuditEntryRead["action"] });
		expect(describeAuditEntry(future)).toBe("connection_deleted");
	});
});

describe("matchesAuditQuery", () => {
	it("matches everything on an empty search", () => {
		expect(matchesAuditQuery(entry(), "")).toBe(true);
		expect(matchesAuditQuery(entry(), "   ")).toBe(true);
	});

	it("searches the actor, the subject and the sentence", () => {
		expect(matchesAuditQuery(entry(), "grace")).toBe(true);
		expect(matchesAuditQuery(entry(), "ada@")).toBe(true);
		expect(matchesAuditQuery(entry(), "opened")).toBe(true);
		expect(matchesAuditQuery(entry(), "alan")).toBe(false);
	});

	it("is case insensitive", () => {
		expect(matchesAuditQuery(entry(), "GRACE")).toBe(true);
	});
});
