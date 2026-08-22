"use client";

/**
 * One requestAnimationFrame loop for every animated readout on the page.
 *
 * A dashboard can hold twenty pulse lines and a dozen counting numbers. Twenty
 * independent rAF loops all doing trivial work is how a "calm" panel starts
 * dropping frames, so everything shares this ticker and the loop stops entirely
 * when the last subscriber leaves.
 */

export type Tick = (now: number) => void;

const subscribers = new Set<Tick>();
let frame: number | null = null;

/** ~30fps. The trace is a 24px waveform; 60fps buys nothing visible. */
const MIN_FRAME_MS = 1000 / 30;
let lastEmit = 0;

function loop(now: number) {
  frame = requestAnimationFrame(loop);
  if (now - lastEmit < MIN_FRAME_MS) return;
  lastEmit = now;
  for (const subscriber of subscribers) subscriber(now);
}

export function subscribeToTicker(subscriber: Tick): () => void {
  subscribers.add(subscriber);
  if (frame === null && typeof requestAnimationFrame !== "undefined") {
    lastEmit = 0;
    frame = requestAnimationFrame(loop);
  }
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0 && frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };
}

/** Exported for tests. */
export function tickerSubscriberCount(): number {
  return subscribers.size;
}
