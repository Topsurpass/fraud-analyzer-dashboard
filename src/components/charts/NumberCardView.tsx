"use client";

import { useEffect, useState } from "react";
import type { NumberData } from "@/services/charts/shape";
import { formatMetric } from "@/services/format";
import { subscribeToTicker } from "@/lib/ticker";
import { useReducedMotion } from "@/lib/useReducedMotion";

/**
 * The big-number readout.
 *
 * It counts from the old value to the new one on every change. That is the
 * point: a number that animates reads as a live instrument reading, while the
 * same number replaced instantly reads as a static label. The tween is short
 * (500ms) so the panel still feels fast.
 *
 * With reduced motion the value snaps instead. The information that it moved is
 * still delivered - by the card's pulse line and its "changed" label - so only
 * the movement is dropped, never the meaning.
 */

const COUNT_MS = 500;

/** Ease-out cubic: fast start, settled end. A readout, not a slot machine. */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

interface Tween {
  from: number;
  to: number;
}

export interface NumberCardViewProps {
  data: NumberData;
  title: string;
}

export function NumberCardView({ data, title }: NumberCardViewProps) {
  const reducedMotion = useReducedMotion();
  const target = data.value;

  const [tracked, setTracked] = useState<number | null>(target);
  const [displayed, setDisplayed] = useState<number | null>(target);
  const [tween, setTween] = useState<Tween | null>(null);

  // Start a count-up when the value moves. Adjusting state during render is
  // React's documented way to react to a changed prop without an extra frame,
  // and it keeps the animation itself out of the effect body.
  if (target !== tracked) {
    const from = displayed ?? tracked;
    setTracked(target);
    if (target === null || from === null || reducedMotion) {
      setDisplayed(target);
      setTween(null);
    } else {
      setTween({ from, to: target });
    }
  }

  useEffect(() => {
    if (!tween) return;
    const start = performance.now();
    return subscribeToTicker((now) => {
      const progress = Math.min(1, (now - start) / COUNT_MS);
      setDisplayed(tween.from + (tween.to - tween.from) * easeOutCubic(progress));
      if (progress >= 1) setTween(null);
    });
  }, [tween]);

  const text =
    displayed === null
      ? data.raw === null
        ? "--"
        : String(data.raw)
      : formatMetric(displayed);

  return (
    <div className="@container flex h-full flex-col justify-center px-4 py-2">
      <div
        className="tnum leading-none font-medium"
        style={{ fontSize: "clamp(2rem, 15cqw, 4.25rem)" }}
        // Animated digits must not be announced on every frame.
        aria-hidden="true"
      >
        {text}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="truncate text-[11px] text-muted">{data.label}</span>
        {data.extraRows > 0 ? (
          <span
            className="tnum text-[10px] text-change"
            title={`The query returned ${data.extraRows + 1} rows; a number card shows the first.`}
          >
            +{data.extraRows} rows hidden
          </span>
        ) : null}
      </div>
      {/* Screen readers get the settled value once, not every animation frame. */}
      <span className="sr-only" aria-live="polite">
        {title}: {target === null ? String(data.raw ?? "no value") : formatMetric(target)}
      </span>
    </div>
  );
}
