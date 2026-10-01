import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { PollIntervalField } from "./PollIntervalField";

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <PollIntervalField value={value} onChange={setValue} />;
}

describe("PollIntervalField", () => {
  it("states a value in milliseconds back in words", () => {
    render(<Harness initial="3600000" />);
    expect(screen.getByText("Runs at most once every 1 hour.")).toBeInTheDocument();
  });

  it("updates the readout as the person types", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText("Poll interval (ms)"), "90000");
    expect(screen.getByText("Runs at most once every 1 minute 30 seconds.")).toBeInTheDocument();
  });

  it("says what blank means", () => {
    render(<Harness />);
    expect(screen.getByText("Using the engine's default.")).toBeInTheDocument();
  });

  it("keeps only digits", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("Poll interval (ms)");
    await userEvent.type(input, "1a2,b3");
    expect(input).toHaveValue("123");
  });

  it("refuses to describe zero as an interval", async () => {
    render(<Harness initial="0" />);
    expect(screen.getByText("Enter a number of milliseconds above zero.")).toBeInTheDocument();
  });

  it("fills the field from a preset and marks the active one", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "1 hour" }));

    expect(screen.getByLabelText("Poll interval (ms)")).toHaveValue("3600000");
    expect(screen.getByRole("button", { name: "1 hour" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "5 min" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Runs at most once every 1 hour.")).toBeInTheDocument();
  });

  it("never submits the form from a preset", async () => {
    let submitted = false;
    render(
      <form onSubmit={(event) => { event.preventDefault(); submitted = true; }}>
        <Harness />
      </form>,
    );
    await userEvent.click(screen.getByRole("button", { name: "15 min" }));
    expect(submitted).toBe(false);
  });

  it("says what the setting controls: the database, not the card", () => {
    render(<Harness />);
    const hint = screen.getByText(/The most often this query runs on the database/);
    expect(hint).toHaveTextContent(/however many people or tabs have it open/);
    expect(hint).toHaveTextContent(/Opening or leaving a page never runs it/);
  });
});
