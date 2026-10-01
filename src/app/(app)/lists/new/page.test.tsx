import { describe, expect, it, vi } from "vitest";
import NewListPage from "./page";

const redirect = vi.hoisted(() =>
  vi.fn((path: string) => {
    // Next's redirect() throws to stop rendering; mirror that.
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect }));

describe("the old new-list route", () => {
  it("lands on the lists with the dialog flag, so existing links still work", () => {
    expect(() => NewListPage()).toThrow("NEXT_REDIRECT:/lists?new");
    expect(redirect).toHaveBeenCalledWith("/lists?new");
  });
});
