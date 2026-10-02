import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PublishedBadge, PublishRejectionNote } from "./PublishedBadge";

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

  it("says a request is waiting, and that nobody else can see the chart yet", () => {
    render(<PublishedBadge chart={{ is_public: false, publish_status: "pending" }} />);

    expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
    expect(screen.getByTitle(/Nobody else can see this chart yet/)).toBeInTheDocument();
    // A waiting request must never read as published.
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
  });

  it("marks a rejected chart, and names who declined in the tooltip", () => {
    render(
      <PublishedBadge
        chart={{
          is_public: false,
          publish_status: "private",
          publish_rejection: { reason: "Too broad", rejected_at: "2026-10-01T10:00:00Z", rejected_by_name: "Ada" },
        }}
      />,
    );

    expect(screen.getByText("Not approved")).toBeInTheDocument();
    expect(screen.getByTitle(/Ada declined the request/)).toBeInTheDocument();
  });

  it("stays silent for a private chart that was never asked about", () => {
    const { container } = render(
      <PublishedBadge chart={{ is_public: false, publish_status: "private" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PublishedBadge on a card somebody else shared", () => {
  const published = { is_public: true, publish_status: "published" as const };

  it("says who shared it, since the card did not come from the viewer", () => {
    render(<PublishedBadge chart={published} sharedBy="Grace Hopper" />);
    expect(screen.getByText("Shared by Grace Hopper")).toBeInTheDocument();
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
  });

  it("explains why the card is there and how to keep it in view", () => {
    render(<PublishedBadge chart={published} sharedBy="Grace Hopper" />);
    const title = screen.getByText("Shared by Grace Hopper").closest("span")?.getAttribute("title") ?? "";
    expect(title).toContain("Grace Hopper published this for the whole team");
    expect(title).toContain("cannot remove it");
    expect(title).toContain("pin it");
  });

  it("falls back to a colleague when the name is not known", () => {
    render(<PublishedBadge chart={published} sharedBy={null} />);
    expect(screen.getByText("Shared by a colleague")).toBeInTheDocument();
  });

  it("is still plain Published on the author's own card", () => {
    render(<PublishedBadge chart={published} />);
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.queryByText(/Shared by/)).not.toBeInTheDocument();
  });

  it("shows nothing extra for a chart that is not published", () => {
    const { container } = render(<PublishedBadge chart={{ is_public: false }} sharedBy="Grace" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PublishRejectionNote", () => {
  const rejected = {
    is_public: false,
    publish_status: "private" as const,
    publish_rejection: { reason: "Remove the card number column", rejected_at: "2026-10-01T10:00:00Z", rejected_by_name: "Ada" },
  };

  it("shows the administrator's reason to the author, with the way forward", () => {
    render(<PublishRejectionNote chart={rejected} />);

    const note = screen.getByRole("status");
    expect(note).toHaveTextContent("Ada declined the request.");
    expect(note).toHaveTextContent("Remove the card number column");
    expect(note).toHaveTextContent("ask again");
  });

  it("still says it was declined when no reason was given", () => {
    render(
      <PublishRejectionNote
        chart={{ ...rejected, publish_rejection: { ...rejected.publish_rejection, reason: null } }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("declined the request");
  });

  it("is absent on a chart with no rejection", () => {
    const { container } = render(<PublishRejectionNote chart={{ is_public: false, publish_status: "private" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is absent once the chart is waiting or published, even if a stale rejection is attached", () => {
    for (const status of ["pending", "published"] as const) {
      const { container } = render(
        <PublishRejectionNote chart={{ ...rejected, is_public: status === "published", publish_status: status }} />,
      );
      expect(container).toBeEmptyDOMElement();
    }
  });
});
