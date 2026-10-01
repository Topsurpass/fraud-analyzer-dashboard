// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GlobalError from "./global-error";
import SegmentError from "./(app)/error";

/**
 * The built-in "This page couldn't load" screen says nothing about what failed.
 * These hold the replacement to its one job: show the message and the digest, and
 * offer a way out. Rendered to markup (no DOM) because `GlobalError` returns a
 * whole `<html>` document, which a DOM test container cannot hold.
 */

const boom = Object.assign(new Error("Cannot read properties of undefined (reading 'map')"), {
  digest: "3141592653",
});

describe("global error screen", () => {
  it("is a whole document, so it can stand in for a failed root layout", () => {
    const html = renderToStaticMarkup(<GlobalError error={boom} retry={() => {}} />);
    expect(html.startsWith("<html")).toBe(true);
    expect(html).toContain("<body>");
  });

  it("shows what failed, and the digest to look up in the server log", () => {
    const html = renderToStaticMarkup(<GlobalError error={boom} retry={() => {}} />);
    expect(html).toContain("Cannot read properties of undefined");
    expect(html).toContain("digest: 3141592653");
  });

  it("shows a digest on its own when the message was withheld", () => {
    const hidden = Object.assign(new Error(""), { digest: "abc123" });
    expect(renderToStaticMarkup(<GlobalError error={hidden} retry={() => {}} />)).toContain(
      "digest: abc123",
    );
  });

  it("offers Try again whichever recovery function Next passes", () => {
    expect(renderToStaticMarkup(<GlobalError error={boom} retry={() => {}} />)).toContain("Try again");
    expect(renderToStaticMarkup(<GlobalError error={boom} reset={() => {}} />)).toContain("Try again");
  });

  it("always offers a reload, even with no recovery function", () => {
    const html = renderToStaticMarkup(<GlobalError error={boom} />);
    expect(html).toContain("Reload the page");
    expect(html).not.toContain("Try again");
  });
});

describe("segment error screen", () => {
  it("prefers retry, which re-fetches, and still works with reset alone", () => {
    expect(renderToStaticMarkup(<SegmentError error={boom} retry={() => {}} />)).toContain("Try again");
    expect(renderToStaticMarkup(<SegmentError error={boom} reset={() => {}} />)).toContain("Try again");
  });

  it("shows the message", () => {
    expect(renderToStaticMarkup(<SegmentError error={boom} retry={() => {}} />)).toContain(
      "Cannot read properties of undefined",
    );
  });
});
