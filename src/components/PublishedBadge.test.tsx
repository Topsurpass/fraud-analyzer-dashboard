import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PublishedBadge } from "./PublishedBadge";

describe("PublishedBadge", () => {
  it("says nothing for a private chart", () => {
    // Most charts are private, so the badge is the exception. A mark on every
    // card would carry no information at all.
    const { container } = render(<PublishedBadge chart={{ is_public: false }} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("marks a published chart", () => {
    render(<PublishedBadge chart={{ is_public: true }} />);

    expect(screen.getByText("Published")).toBeInTheDocument();
  });

  it("names the consequence, not just the state", () => {
    // "Published" alone does not tell anyone their query is now frozen, which
    // is the part they discover later while trying to edit the SQL.
    render(<PublishedBadge chart={{ is_public: true }} />);

    expect(screen.getByTitle(/query is frozen/i)).toBeInTheDocument();
  });

  it("spells the consequence out for a screen reader too", () => {
    render(<PublishedBadge chart={{ is_public: true }} />);

    expect(screen.getByText(/Visible to everyone signed in/)).toBeInTheDocument();
  });
});
