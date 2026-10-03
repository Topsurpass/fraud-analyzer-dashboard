import { describe, expect, it } from "vitest";
import { publishActionFor, publishStatusOf, rejectionNote } from "./state";

const rejection = { reason: "Too broad", rejected_at: "2026-10-01T10:00:00Z", rejected_by_name: "Ada" };

describe("publishStatusOf", () => {
	it("reads the engine's status when it sends one", () => {
		expect(publishStatusOf({ is_public: false, publish_status: "pending" })).toBe("pending");
		expect(publishStatusOf({ is_public: true, publish_status: "published" })).toBe("published");
	});

	it("falls back to is_public for an engine that predates the workflow", () => {
		expect(publishStatusOf({ is_public: true })).toBe("published");
		expect(publishStatusOf({ is_public: false })).toBe("private");
	});
});

describe("publishActionFor: every pairing of state and person", () => {
	it("an administrator publishes a private chart at once", () => {
		const action = publishActionFor({ is_public: false, publish_status: "private" }, true);
		expect(action.kind).toBe("publish");
		expect(action.label).toMatch(/^Publish to the team/);
	});

	it("an analyst can only ask, and the menu says so", () => {
		const action = publishActionFor({ is_public: false, publish_status: "private" }, false);
		expect(action.kind).toBe("request");
		expect(action.label).toMatch(/^Request publishing/);
		expect(action.label).not.toMatch(/^Publish/);
	});

	it("an analyst whose request was rejected is offered to ask again", () => {
		const action = publishActionFor(
			{ is_public: false, publish_status: "private", publish_rejection: rejection },
			false,
		);
		expect(action.kind).toBe("request");
		expect(action.label).toBe("Request publishing again");
	});

	it("a waiting request can be withdrawn by an analyst", () => {
		const action = publishActionFor({ is_public: false, publish_status: "pending" }, false);
		expect(action.kind).toBe("withdraw");
		expect(action.label).toMatch(/^Withdraw publish request/);
	});

	it("a waiting request sends an administrator to the queue instead of acting on it", () => {
		expect(publishActionFor({ is_public: false, publish_status: "pending" }, true).kind).toBe(
			"review",
		);
	});

	it("a published chart can be taken down by either", () => {
		for (const admin of [true, false]) {
			expect(
				publishActionFor({ is_public: true, publish_status: "published" }, admin).kind,
			).toBe("unpublish");
		}
	});

	it("an old engine's published chart behaves as published", () => {
		expect(publishActionFor({ is_public: true }, false).kind).toBe("unpublish");
	});

	it("never offers a plain publish to someone who is not an administrator", () => {
		for (const status of ["private", "pending", "published"] as const) {
			expect(publishActionFor({ is_public: status === "published", publish_status: status }, false).kind).not.toBe(
				"publish",
			);
		}
	});

	it("every action that sends a request has a busy label", () => {
		for (const status of ["private", "pending", "published"] as const) {
			for (const admin of [true, false]) {
				const action = publishActionFor({ is_public: status === "published", publish_status: status }, admin);
				if (action.kind !== "review") expect(action.busyLabel, `${status}/${admin}`).toBeTruthy();
			}
		}
	});
});

describe("rejectionNote", () => {
	it("names who declined and why", () => {
		expect(rejectionNote(rejection)).toEqual({
			headline: "Not published: Ada declined the request.",
			reason: "Too broad",
		});
	});

	it("reports no reason when none was given", () => {
		expect(rejectionNote({ ...rejection, reason: null })?.reason).toBeNull();
		expect(rejectionNote({ ...rejection, reason: "   " })?.reason).toBeNull();
	});

	it("is null when there is no rejection", () => {
		expect(rejectionNote(null)).toBeNull();
		expect(rejectionNote(undefined)).toBeNull();
	});
});
