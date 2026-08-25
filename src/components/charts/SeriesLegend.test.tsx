import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SeriesLegend } from "./SeriesLegend";

const series = [
  { id: "api", label: "api", color: "#3987e5" },
  { id: "web", label: "web", color: "#199e70" },
];

describe("SeriesLegend", () => {
  it("renders nothing for a single series, since the title already names it", () => {
    const { container } = render(
      <SeriesLegend series={[series[0]]} active={null} onActiveChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every series once there are two or more", () => {
    render(<SeriesLegend series={series} active={null} onActiveChange={vi.fn()} />);
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();
  });

  it("highlights on hover", async () => {
    const onActiveChange = vi.fn();
    render(<SeriesLegend series={series} active={null} onActiveChange={onActiveChange} />);

    await userEvent.hover(screen.getByRole("button", { name: /api/ }));
    expect(onActiveChange).toHaveBeenCalledWith("api");

    await userEvent.unhover(screen.getByRole("button", { name: /api/ }));
    expect(onActiveChange).toHaveBeenLastCalledWith(null);
  });

  it("highlights on keyboard focus too, so the interaction is reachable", async () => {
    const onActiveChange = vi.fn();
    render(<SeriesLegend series={series} active={null} onActiveChange={onActiveChange} />);

    await userEvent.tab();
    expect(onActiveChange).toHaveBeenCalledWith("api");
  });

  it("dims the series that are not highlighted", () => {
    render(<SeriesLegend series={series} active="api" onActiveChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /api/ })).toHaveStyle({ opacity: "1" });
    expect(screen.getByRole("button", { name: /web/ })).toHaveStyle({ opacity: "0.35" });
  });
});
