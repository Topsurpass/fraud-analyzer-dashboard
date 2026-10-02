import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { PollIntervalField } from "./PollIntervalField";

function Harness({ initial = "", onValue }: { initial?: string; onValue?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <PollIntervalField
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
    />
  );
}

describe("PollIntervalField", () => {
  it("states a value in milliseconds back in words", () => {
    render(<Harness initial="3600000" />);
    expect(screen.getByText("Runs at most once every 1 hour.")).toBeInTheDocument();
  });

  it("updates the readout as the person types", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText("Run every"), "90");
    // 90 minutes is stated as the person would say it.
    expect(screen.getByText("Runs at most once every 1 hour 30 minutes.")).toBeInTheDocument();
  });

  it("says what blank means", () => {
    render(<Harness />);
    expect(screen.getByText("Using the engine's default.")).toBeInTheDocument();
  });

  it("keeps only digits", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("Run every");
    await userEvent.type(input, "1a2,b3");
    expect(input).toHaveValue("123");
  });

  it("refuses to describe zero as an interval", async () => {
    render(<Harness initial="0" />);
    expect(screen.getByText("Enter a number above zero.")).toBeInTheDocument();
  });

  it("fills the field from a preset and marks the active one", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "1 hour" }));

    expect(screen.getByLabelText("Run every")).toHaveValue("1");
    expect(screen.getByLabelText("Unit of time")).toHaveValue("hours");
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

  it("asks in units: a number and a unit become the milliseconds the engine stores", async () => {
    let stored = "";
    render(<Harness onValue={(value) => (stored = value)} />);
    await userEvent.type(screen.getByLabelText("Run every"), "5");
    expect(stored).toBe("300000");
    await userEvent.selectOptions(screen.getByLabelText("Unit of time"), "hours");
    expect(screen.getByLabelText("Run every")).toHaveValue("5");
    expect(stored).toBe("18000000");
  });

  it("shows a stored value in the biggest unit that divides it evenly", () => {
    render(<Harness initial="90000" />);
    expect(screen.getByLabelText("Run every")).toHaveValue("90");
    expect(screen.getByLabelText("Unit of time")).toHaveValue("seconds");
  });

  it("can leave the sentence to the host, but still refuses zero out loud", () => {
    render(<PollIntervalField value="0" onChange={() => {}} readout={false} />);
    expect(screen.queryByText(/Runs at most/)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a number above zero.");
  });
});
