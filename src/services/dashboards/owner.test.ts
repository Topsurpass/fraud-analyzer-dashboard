import { describe, expect, it } from "vitest";
import { ownerLabel } from "./owner";

const board = (over: Partial<Parameters<typeof ownerLabel>[0]> = {}) => ({
  owner_id: "u1",
  owner_name: "Kemi Adeyemi",
  owner_email: "kemi@example.com",
  ...over,
});

describe("ownerLabel", () => {
  it("names the owner of somebody else's board", () => {
    expect(ownerLabel(board(), "me")).toBe("Kemi Adeyemi");
  });

  it("says nothing about your own boards", () => {
    // Most of what an analyst sees. Captioning it "you" is noise.
    expect(ownerLabel(board({ owner_id: "me" }), "me")).toBeNull();
  });

  it("falls back to the address when the account has no name", () => {
    expect(ownerLabel(board({ owner_name: null }), "me")).toBe("kemi");
    expect(ownerLabel(board({ owner_name: "   " }), "me")).toBe("kemi");
  });

  it("calls a board that predates accounts unowned rather than yours", () => {
    // The state `fae claim-unowned` exists to fix. Silence would read as mine.
    expect(ownerLabel(board({ owner_id: null }), "me")).toBe("Unowned");
  });

  it("still labels an owned board whose account did not resolve", () => {
    expect(ownerLabel(board({ owner_name: null, owner_email: null }), "me")).toBe(
      "Another account",
    );
  });

  it("labels every board when the viewer is not signed in yet", () => {
    expect(ownerLabel(board(), null)).toBe("Kemi Adeyemi");
  });
});
