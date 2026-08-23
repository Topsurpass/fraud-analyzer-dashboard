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
