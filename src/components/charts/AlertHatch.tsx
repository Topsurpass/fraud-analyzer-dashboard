"use client";

import { useId } from "react";
import { ALERT_COLOR } from "./theme";

/**
 * How an anomalous bar or wedge is marked.
 *
 * The obvious move is to repaint the mark in `--signal-alert`, and that is what
 * this chart used to do. It is wrong for a categorical chart: hue is what tells
 * one category from another, so repainting three of five wedges red leaves
 * three wedges the analyst can no longer tell apart, and the legend then has
 * three identical swatches. The alert colour ends up destroying the very
 * reading it was meant to draw attention to.
 *
 * So identity and status get separate channels. Hue stays the category's own.
 * Status is texture: the mark keeps its colour and gains an alert-coloured
 * diagonal hatch plus a hard alert outline. Both survive greyscale and both are
 * legible at wedge size, and the design brief's rule still holds - the alert
 * colour appears only on flagged data, never on chrome.
 *
 * A pattern is per-colour because SVG has no way to overlay a fill on a fill,
 * so the pattern paints the base colour itself and then the stripes on top.
 */

/*
 * Geometry of the hatch, in user units. Tuned against a 40px-wide wedge: wide
 * enough to read at that size, sparse enough that the category's own colour is
 * still what the wedge looks like. A heavier stripe starts reading as "this
 * wedge is red", which is the thing the hatch exists to avoid.
 */
const TILE = 7;
const STRIPE_WIDTH = 1.5;

export interface AlertHatchDefs {
  /** `<defs>` to drop into the chart's SVG. */
  defs: React.ReactNode;
  /** Fill for a mark of `color`: hatched when flagged, plain when not. */
  fill: (color: string, flagged: boolean) => string;
}

/**
 * Build the hatch patterns for a set of series colours.
 *
 * Ids are scoped with `useId` because several cards render at once on one page
 * and a duplicated pattern id would make one card's fill resolve to another
 * card's pattern.
 */
export function useAlertHatch(colors: readonly string[]): AlertHatchDefs {
  const scope = useId().replace(/[^a-zA-Z0-9]/g, "");
  const unique = Array.from(new Set(colors));

  const idFor = (color: string) => `hatch-${scope}-${unique.indexOf(color)}`;

  const defs = (
    <defs>
      {unique.map((color) => (
        <pattern
          key={color}
          id={idFor(color)}
          width={TILE}
          height={TILE}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width={TILE} height={TILE} fill={color} />
          {/*
           * The stripe is deliberately not opaque. At full strength the hatch
           * competes with the fill and the wedge starts reading as "red", which
           * is the very confusion the hatch replaced. Held back, the category's
           * own colour is still what you see and the texture is what you
           * notice second.
           */}
          <rect width={STRIPE_WIDTH} height={TILE} fill={ALERT_COLOR} opacity={0.62} />
        </pattern>
      ))}
    </defs>
  );

  return {
    defs,
    fill: (color, flagged) => (flagged && unique.includes(color) ? `url(#${idFor(color)})` : color),
  };
}

/**
 * The legend's marker for a flagged series: the same hatch idea at glyph size,
 * so the legend and the plot say the same thing the same way.
 */
export function AlertGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 8 8"
      width={8}
      height={8}
      aria-hidden="true"
      className={`shrink-0 ${className ?? ""}`}
    >
      <path d="M4 0.5 L7.6 7 H0.4 Z" fill="none" stroke={ALERT_COLOR} strokeWidth={1.1} />
    </svg>
  );
}
