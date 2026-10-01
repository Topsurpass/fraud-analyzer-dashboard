import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

function setup(props: Partial<React.ComponentProps<typeof Modal>> = {}) {
  const onClose = vi.fn();
  const view = render(
    <Modal open onClose={onClose} title="Edit thing" description="Some context" {...props}>
      <input aria-label="Field" />
      <input aria-label="Preferred" data-autofocus />
    </Modal>,
  );
  return { onClose, ...view };
}

const cancelEvent = () =>
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));

describe("Modal", () => {
  it("is a labelled, described dialog while open", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Edit thing" });
    expect(dialog).toHaveAccessibleDescription("Some context");
  });

  it("mounts its body only while open, so each opening starts fresh", () => {
    const { rerender } = setup({ open: false });
    expect(screen.queryByLabelText("Field")).not.toBeInTheDocument();
    rerender(
      <Modal open onClose={() => {}} title="Edit thing">
        <input aria-label="Field" />
      </Modal>,
    );
    expect(screen.getByLabelText("Field")).toBeInTheDocument();
  });

  it("moves focus to the control marked data-autofocus", () => {
    setup();
    expect(screen.getByLabelText("Preferred")).toHaveFocus();
  });

  it("closes from the close button", async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("handles Escape itself: prevents the native close and asks the owner", () => {
    const { onClose } = setup();
    const notCancelled = cancelEvent();
    expect(notCancelled).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a click on the backdrop, but not a click inside the box", () => {
    const { onClose } = setup();
    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(screen.getByLabelText("Field"));
    fireEvent.click(screen.getByLabelText("Field"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when a drag that began inside ends on the backdrop", () => {
    const { onClose } = setup();
    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(screen.getByLabelText("Field"));
    fireEvent.click(dialog); // the click lands on the dialog, having started elsewhere
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refuses every way out while it cannot be interrupted", () => {
    const { onClose } = setup({ dismissible: false });
    const dialog = screen.getByRole("dialog");

    expect(cancelEvent()).toBe(false); // still prevented, so the browser does not close it
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("locks page scroll while open and restores it after", () => {
    document.body.style.overflow = "auto";
    const { rerender } = setup();
    expect(document.body.style.overflow).toBe("hidden");
    rerender(
      <Modal open={false} onClose={() => {}} title="Edit thing">
        x
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
  });
});
