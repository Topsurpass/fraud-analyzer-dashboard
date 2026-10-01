import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Popover, usePopoverClose } from "./Popover";

/**
 * The bug these exist for: the menus were bare `<details>`, so they stayed open
 * after you picked something and stayed open when you clicked the page behind
 * them. Two could be open at once, overlapping the cards you were reading.
 */

function Item({ label, keepOpen = false }: { label: string; keepOpen?: boolean }) {
  const close = usePopoverClose();
  return (
    <button type="button" onClick={keepOpen ? undefined : close}>
      {label}
    </button>
  );
}

function Subject({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  return (
    <div>
      <p>outside the menu</p>
      <Popover
        label="Actions for card"
        trigger={<span aria-hidden="true">⋯</span>}
        onOpenChange={onOpenChange}
      >
        <Item label="Pick me" />
        <Item label="Stay open" keepOpen />
      </Popover>
    </div>
  );
}

const open = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByLabelText("Actions for card"));

describe("Popover", () => {
  it("shows nothing until the trigger is used", () => {
    render(<Subject />);
    expect(screen.queryByRole("button", { name: "Pick me" })).not.toBeInTheDocument();
  });

  it("opens on the trigger", async () => {
    const user = userEvent.setup();
    render(<Subject />);
    await open(user);
    expect(screen.getByRole("button", { name: "Pick me" })).toBeInTheDocument();
  });

  it("closes when an item asks it to", async () => {
    const user = userEvent.setup();
    render(<Subject />);
    await open(user);
    await user.click(screen.getByRole("button", { name: "Pick me" }));
    expect(screen.queryByRole("button", { name: "Pick me" })).not.toBeInTheDocument();
  });

  it("stays open for an item that does not", async () => {
    const user = userEvent.setup();
    render(<Subject />);
    await open(user);
    await user.click(screen.getByRole("button", { name: "Stay open" }));
    expect(screen.getByRole("button", { name: "Stay open" })).toBeInTheDocument();
  });

  it("closes on a click outside it", async () => {
    const user = userEvent.setup();
    render(<Subject />);
    await open(user);
    await user.click(screen.getByText("outside the menu"));
    expect(screen.queryByRole("button", { name: "Pick me" })).not.toBeInTheDocument();
  });

  it("does not close on a click inside the panel", async () => {
    const user = userEvent.setup();
    render(
      <Popover label="Actions for card" trigger={<span>⋯</span>}>
        <p>just some text</p>
      </Popover>,
    );
    await open(user);
    await user.click(screen.getByText("just some text"));
    expect(screen.getByText("just some text")).toBeInTheDocument();
  });

  it("closes on Escape and hands focus back to the trigger", async () => {
    const user = userEvent.setup();
    render(<Subject />);
    await open(user);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("button", { name: "Pick me" })).not.toBeInTheDocument();
    // Escape must not strand the keyboard on an element that is now gone.
    expect(screen.getByLabelText("Actions for card")).toHaveFocus();
  });

  it("reports every open and close once", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Subject onOpenChange={onOpenChange} />);

    await open(user);
    await user.click(screen.getByRole("button", { name: "Pick me" }));

    expect(onOpenChange.mock.calls.map(([value]) => value)).toEqual([true, false]);
  });

  it("throws away panel state when it closes", async () => {
    // A half-finished confirmation must not be waiting on the next open.
    function Counter() {
      const close = usePopoverClose();
      return (
        <>
          <button type="button" onClick={close}>
            close
          </button>
          <input aria-label="draft" defaultValue="" />
        </>
      );
    }
    const user = userEvent.setup();
    render(
      <Popover label="Actions for card" trigger={<span>⋯</span>}>
        <Counter />
      </Popover>,
    );

    await open(user);
    await user.type(screen.getByLabelText("draft"), "half typed");
    await user.click(screen.getByRole("button", { name: "close" }));
    await open(user);

    expect(screen.getByLabelText("draft")).toHaveValue("");
  });

  it("closes one menu when another is opened", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Popover label="First card" trigger={<span>⋯</span>}>
          <p>first panel</p>
        </Popover>
        <Popover label="Second card" trigger={<span>⋯</span>}>
          <p>second panel</p>
        </Popover>
      </div>,
    );

    await user.click(screen.getByLabelText("First card"));
    expect(screen.getByText("first panel")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Second card"));
    expect(screen.queryByText("first panel")).not.toBeInTheDocument();
    expect(screen.getByText("second panel")).toBeInTheDocument();
  });
});

/**
 * The bug: the card menu is 15 items and about 570px tall, and drawn inside its
 * card it was clipped by the card's `overflow-hidden` (and by the paint
 * containment `defer-paint` adds, which clips even `position: fixed`). Five
 * items were reachable on a number card, nine on the rest. jsdom has no layout,
 * so what is asserted is the structure that fixes it: the panel is not inside
 * the card at all. `scripts/check-layout.mjs` measures the real thing.
 */
describe("Popover panel placement", () => {
  function InCard() {
    return (
      <div data-testid="card" className="overflow-hidden">
        <Popover label="Actions for card" trigger={<span aria-hidden="true">⋯</span>}>
          <Item label="First" keepOpen />
          <Item label="Last" keepOpen />
        </Popover>
      </div>
    );
  }

  it("draws the panel outside the card that opened it", async () => {
    const user = userEvent.setup();
    render(<InCard />);
    await open(user);
    const item = screen.getByRole("button", { name: "First" });
    expect(item.closest('[data-testid="card"]')).toBeNull();
    const panel = item.parentElement as HTMLElement;
    expect(panel.parentElement).toBe(document.body);
    expect(panel.style.position).toBe("fixed");
  });

  it("is placed, and visible, once it has been measured", async () => {
    const user = userEvent.setup();
    render(<InCard />);
    await open(user);
    const panel = screen.getByRole("button", { name: "First" }).parentElement as HTMLElement;
    expect(panel.style.visibility).not.toBe("hidden");
    expect(panel.style.maxHeight).not.toBe("");
    expect(panel.className).toContain("overflow-y-auto");
  });

  it("keeps the panel open when the click lands inside it", async () => {
    const user = userEvent.setup();
    render(<InCard />);
    await open(user);
    await user.click(screen.getByRole("button", { name: "First" }));
    expect(screen.getByRole("button", { name: "First" })).toBeInTheDocument();
  });

  it("still closes on a click anywhere else", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <p>elsewhere</p>
        <InCard />
      </div>,
    );
    await open(user);
    await user.click(screen.getByText("elsewhere"));
    expect(screen.queryByRole("button", { name: "First" })).not.toBeInTheDocument();
  });

  it("is reachable from the keyboard although it moved in the DOM", async () => {
    const user = userEvent.setup();
    render(<InCard />);
    // jsdom does not toggle a <details> on Enter; a real browser does, and
    // `scripts/check-layout.mjs` drives that. Open it by click, then use keys.
    await open(user);
    screen.getByLabelText("Actions for card").focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
  });

  it("returns to the trigger, and closes, when tabbing past the last item", async () => {
    const user = userEvent.setup();
    render(<InCard />);
    await open(user);
    screen.getByRole("button", { name: "Last" }).focus();
    await user.tab();
    expect(screen.queryByRole("button", { name: "Last" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Actions for card")).toHaveFocus();
  });

  it("returns to the trigger, still open, on Shift+Tab from the first item", async () => {
    const user = userEvent.setup();
    render(<InCard />);
    await open(user);
    screen.getByRole("button", { name: "First" }).focus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "First" })).toBeInTheDocument();
    expect(screen.getByLabelText("Actions for card")).toHaveFocus();
  });
});
