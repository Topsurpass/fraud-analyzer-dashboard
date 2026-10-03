import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Modal } from "./Modal";
import { Popover } from "./Popover";
import { isFlagOrderHeld, resetFlagOrderHold } from "./flagOrderHold";

/**
 * Anything that has the reader's attention must keep the board still: a card
 * that slides away from under an open menu, or from behind a dialog, is the one
 * way this feature could make the board worse. These hold the wiring.
 */

afterEach(() => resetFlagOrderHold());

describe("things that hold the board", () => {
  it("holds while a popover menu is open and lets go when it closes", async () => {
    const user = userEvent.setup();
    render(
      <Popover label="Actions" trigger={<span>⋯</span>}>
        <button type="button">Item</button>
      </Popover>,
    );
    expect(isFlagOrderHeld()).toBe(false);
    await user.click(screen.getByLabelText("Actions"));
    expect(isFlagOrderHeld()).toBe(true);
    await user.keyboard("{Escape}");
    expect(isFlagOrderHeld()).toBe(false);
  });

  it("holds while a dialog is open and lets go when it closes", () => {
    const { rerender } = render(
      <Modal open={false} onClose={() => {}} title="Dialog">
        <p>body</p>
      </Modal>,
    );
    expect(isFlagOrderHeld()).toBe(false);
    rerender(
      <Modal open onClose={() => {}} title="Dialog">
        <p>body</p>
      </Modal>,
    );
    expect(isFlagOrderHeld()).toBe(true);
    rerender(
      <Modal open={false} onClose={() => {}} title="Dialog">
        <p>body</p>
      </Modal>,
    );
    expect(isFlagOrderHeld()).toBe(false);
  });

  it("lets go when a held popover unmounts", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <Popover label="Actions" trigger={<span>⋯</span>}>
        <button type="button">Item</button>
      </Popover>,
    );
    await user.click(screen.getByLabelText("Actions"));
    expect(isFlagOrderHeld()).toBe(true);
    unmount();
    expect(isFlagOrderHeld()).toBe(false);
  });
});
