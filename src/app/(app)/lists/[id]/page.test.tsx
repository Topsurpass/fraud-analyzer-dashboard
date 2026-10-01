import { describe, expect, it, vi } from "vitest";
import ListPage from "./page";

const redirect = vi.hoisted(() =>
  vi.fn((path: string) => {
    // Next's redirect() throws to stop rendering; mirror that.
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect }));

describe("the old one-list route", () => {
  it("lands on the lists with that list's dialog open, so existing links still work", async () => {
    await expect(ListPage({ params: Promise.resolve({ id: "l1" }) })).rejects.toThrow(
      "NEXT_REDIRECT:/lists?open=l1",
    );
  });

  it("encodes an id so it cannot add query parameters of its own", async () => {
    await expect(ListPage({ params: Promise.resolve({ id: "a&new=1" }) })).rejects.toThrow(
      "NEXT_REDIRECT:/lists?open=a%26new%3D1",
    );
  });
});
