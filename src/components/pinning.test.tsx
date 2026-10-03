import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChartGrid } from "./ChartGrid";
import { useReportFlags } from "./FlagOrder";
import { PinButton } from "./PinButton";
import { POINTER_RELEASE_MS, resetFlagOrderHold } from "./flagOrderHold";
import { resetPinStore } from "@/services/pins/pinStore";
import { pinStorageKey } from "@/services/pins/pins";
import type { FlagSeverity } from "@/contracts/api";

/**
 * Pinning, through the real grid and the real button. The glide itself is checked
 * in a real browser (`scripts/check-reorder.mjs`); what is held here is WHO goes
 * where, that it survives a reload, and that two people do not share pins.
 */

let currentUser: { id: string } | null = { id: "u1" };
vi.mock("@/services/auth/AuthContext", () => ({
  useOptionalUser: () => currentUser,
  useAuth: () => ({ user: currentUser }),
}));

beforeEach(() => {
  currentUser = { id: "u1" };
  window.localStorage.clear();
  resetPinStore();
});
afterEach(() => {
  resetFlagOrderHold();
  vi.restoreAllMocks();
});

function Card({ id, count = 0, severity = "high" }: { id: string; count?: number; severity?: FlagSeverity }) {
  useReportFlags(id, count, count > 0 ? severity : null);
  return (
    <article data-id={id}>
      {id}
      <PinButton id={id} name={id} />
    </article>
  );
}

const ids = (container: HTMLElement) =>
  [...container.querySelectorAll("article")].map((node) => node.getAttribute("data-id"));
const tick = () => act(async () => void (await Promise.resolve()));

function board(counts: Record<string, number>) {
  return (
    <ChartGrid>
      {Object.entries(counts).map(([id, count]) => (
        <Card key={id} id={id} count={count} />
      ))}
    </ChartGrid>
  );
}

describe("the pin button", () => {
  it("says what it will do and reports its state", async () => {
    render(board({ a: 0 }));
    const button = screen.getByRole("button", { name: "Pin a to the top" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(button);
    expect(screen.getByRole("button", { name: "Unpin a" })).toHaveAttribute("aria-pressed", "true");
  });

  it("is reachable and operable from the keyboard", async () => {
    const user = userEvent.setup();
    render(board({ a: 0, b: 0 }));
    screen.getByRole("button", { name: "Pin b to the top" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Unpin b" })).toBeInTheDocument();
  });
});

describe("pinned cards", () => {
  it("move to the top when pinned, and back when unpinned", async () => {
    const { container } = render(board({ a: 0, b: 0, c: 0 }));
    await tick();
    await userEvent.click(screen.getByRole("button", { name: "Pin c to the top" }));
    expect(ids(container)).toEqual(["c", "a", "b"]);
    await userEvent.click(screen.getByRole("button", { name: "Unpin c" }));
    expect(ids(container)).toEqual(["a", "b", "c"]);
  });

  it("keep the order they were pinned in", async () => {
    const { container } = render(board({ a: 0, b: 0, c: 0, d: 0 }));
    await tick();
    await userEvent.click(screen.getByRole("button", { name: "Pin d to the top" }));
    await userEvent.click(screen.getByRole("button", { name: "Pin b to the top" }));
    expect(ids(container)).toEqual(["d", "b", "a", "c"]);
  });

  it("stay put when another card is flagged", async () => {
    const { container, rerender } = render(board({ a: 0, b: 0, c: 0 }));
    await tick();
    await userEvent.click(screen.getByRole("button", { name: "Pin c to the top" }));
    rerender(board({ a: 5, b: 0, c: 0 }));
    await tick();
    // The flagged card rises, but only to just below what is pinned.
    expect(ids(container)).toEqual(["c", "a", "b"]);
  });

  it("stay put when they are themselves flagged", async () => {
    const { container, rerender } = render(board({ a: 0, b: 0, c: 0 }));
    await tick();
    await userEvent.click(screen.getByRole("button", { name: "Pin b to the top" }));
    await userEvent.click(screen.getByRole("button", { name: "Pin c to the top" }));
    rerender(board({ a: 0, b: 0, c: 9 }));
    await tick();
    expect(ids(container)).toEqual(["b", "c", "a"]);
  });

  it("rejoin the flag ranking when unpinned", async () => {
    const { container, rerender } = render(board({ a: 0, b: 0, c: 0 }));
    await tick();
    await userEvent.click(screen.getByRole("button", { name: "Pin a to the top" }));
    // The click's pointer hold is still running; a real poll arrives after it.
    await act(async () => new Promise((resolve) => setTimeout(resolve, POINTER_RELEASE_MS + 40)));
    rerender(board({ a: 0, b: 0, c: 4 }));
    await tick();
    expect(ids(container)).toEqual(["a", "c", "b"]);
    await userEvent.click(screen.getByRole("button", { name: "Unpin a" }));
    expect(ids(container)).toEqual(["c", "a", "b"]);
  });

  it("move at once, even while the pointer is down (it is the person's own action)", async () => {
    const { container } = render(board({ a: 0, b: 0 }));
    await tick();
    await act(async () => {
      document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    await userEvent.click(screen.getByRole("button", { name: "Pin b to the top" }));
    expect(ids(container)).toEqual(["b", "a"]);
  });
});

describe("where pins are kept", () => {
  it("stores them under the person's own key, in pin order", async () => {
    render(board({ a: 0, b: 0 }));
    await userEvent.click(screen.getByRole("button", { name: "Pin b to the top" }));
    await userEvent.click(screen.getByRole("button", { name: "Pin a to the top" }));
    expect(JSON.parse(window.localStorage.getItem(pinStorageKey("u1")) ?? "null")).toEqual(["b", "a"]);
  });

  it("survives a reload", async () => {
    const first = render(board({ a: 0, b: 0, c: 0 }));
    await tick();
    await userEvent.click(screen.getByRole("button", { name: "Pin c to the top" }));
    first.unmount();
    resetPinStore(); // a new page: nothing in memory, only what was stored

    const { container } = render(board({ a: 0, b: 0, c: 0 }));
    await tick();
    expect(ids(container)).toEqual(["c", "a", "b"]);
  });

  it("does not share pins between two people on one browser", async () => {
    render(board({ a: 0, b: 0 }));
    await userEvent.click(screen.getByRole("button", { name: "Pin b to the top" }));
    expect(window.localStorage.getItem(pinStorageKey("u2"))).toBeNull();

    currentUser = { id: "u2" };
    resetPinStore();
    const { container } = render(board({ a: 0, b: 0 }));
    await tick();
    expect(ids(container)).toEqual(["a", "b"]);
  });

  it("ignores pins for cards that no longer exist", async () => {
    window.localStorage.setItem(pinStorageKey("u1"), JSON.stringify(["gone", "b"]));
    resetPinStore();
    const { container } = render(board({ a: 0, b: 0 }));
    await tick();
    expect(ids(container)).toEqual(["b", "a"]);
  });

  it("reads damaged storage as nothing pinned", async () => {
    window.localStorage.setItem(pinStorageKey("u1"), "{not json");
    resetPinStore();
    const { container } = render(board({ a: 0, b: 0 }));
    await tick();
    expect(ids(container)).toEqual(["a", "b"]);
  });

  it("follows a change made in another tab", async () => {
    const { container } = render(board({ a: 0, b: 0 }));
    await tick();
    window.localStorage.setItem(pinStorageKey("u1"), JSON.stringify(["b"]));
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: pinStorageKey("u1") }));
    });
    expect(ids(container)).toEqual(["b", "a"]);
  });

  it("still works for the page when storage refuses to write", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const { container } = render(board({ a: 0, b: 0 }));
    await tick();
    await userEvent.click(screen.getByRole("button", { name: "Pin b to the top" }));
    expect(ids(container)).toEqual(["b", "a"]);
  });

  it("pins nothing, and stores nothing, when nobody is signed in", async () => {
    currentUser = null;
    resetPinStore();
    const { container } = render(board({ a: 0, b: 0 }));
    await tick();
    await userEvent.click(screen.getByRole("button", { name: "Pin b to the top" }));
    expect(ids(container)).toEqual(["a", "b"]);
    expect(window.localStorage.length).toBe(0);
  });
});
