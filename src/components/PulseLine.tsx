"use client";

import { useEffect, useRef, useState } from "react";
import type { PollPhase } from "@/services/polling/useQueryPolling";
import { subscribeToTicker } from "@/lib/ticker";
import { useReducedMotion } from "@/lib/useReducedMotion";

/**
 * The signature element: a 24px oscilloscope trace of this card's polling.
 *
 * It is not decoration. Every mark on it corresponds to a real poll:
 *
 *   idle      a flat line in --signal-live, with a single-sample tremor each
 *             time a poll comes back unchanged, so it reads as alive, not frozen
 *   changed   one sharp bipolar deflection in --signal-change, injected the
 *             moment the engine reports a new data hash, which then scrolls
 *             away with the trace
 *   error     the line goes dashed and dim, and stops moving
 *
 * The trace scrolls right to left at a fixed rate, so the horizontal axis is
 * genuinely time and an analyst can see at a glance how recently the last
 * change landed.
 */

const SAMPLES = 120;
const VIEW_HEIGHT = 24;
const BASELINE = VIEW_HEIGHT / 2;
/** Peak deflection in viewBox units, leaving a hairline of headroom. */
const AMPLITUDE = BASELINE - 1.5;

/**
 * A change impulse, newest sample last. Shaped as a real deflection - a small
 * pre-swing, a hard spike, a damped overshoot - rather than a triangle, because
 * that is what makes it read as an instrument trace.
 */
const CHANGE_IMPULSE = [0.12, -0.3, 1, -0.62, 0.34, -0.16, 0.07, -0.03];
/** A poll that changed nothing: barely a flicker. */
const TREMOR_IMPULSE = [0.05, -0.07, 0.03];

type SampleKind = 0 | 1;

export interface PulseLineProps {
  phase: PollPhase;
  /** Bumped once per poll that reported changed data. */
  changeSeq: number;
  /** Bumped once per completed poll of any kind. */
  pollSeq: number;
  /** Epoch ms of the last completed poll. Drives the reduced-motion state. */
  lastPolledAt?: number | null;
  /** Epoch ms of the last poll that brought new data. */
  lastChangedAt?: number | null;
  className?: string;
}

export function PulseLine({
  phase,
  changeSeq,
  pollSeq,
  lastPolledAt = null,
  lastChangedAt = null,
  className,
}: PulseLineProps) {
  const reducedMotion = useReducedMotion();

  const values = useRef<Float32Array>(new Float32Array(SAMPLES));
  const kinds = useRef<Uint8Array>(new Uint8Array(SAMPLES));
  const pending = useRef<{ values: number[]; kind: SampleKind }[]>([]);
  const seenChange = useRef(changeSeq);
  const [segments, setSegments] = useState<Segment[]>([]);

  const animated = !reducedMotion && phase !== "error" && phase !== "paused";

  /*
   * Queue one impulse per completed poll. `pollSeq` moves on every poll and
   * `changeSeq` only when the data hash actually moved, and the hook bumps both
   * in the same commit, so this effect runs exactly once per poll and picks the
   * shape from whether the change counter came along with it.
   */
  useEffect(() => {
    if (pollSeq === 0) return;
    const isChange = changeSeq !== seenChange.current;
    seenChange.current = changeSeq;
    // Copy: the impulse is consumed sample by sample, and the constants are
    // shared by every pulse line on the page.
    pending.current.push({
      values: [...(isChange ? CHANGE_IMPULSE : TREMOR_IMPULSE)],
      kind: isChange ? 1 : 0,
    });
  }, [pollSeq, changeSeq]);

  useEffect(() => {
    if (!animated) return;
    return subscribeToTicker(() => {
      const sampleValues = values.current;
      const sampleKinds = kinds.current;

      // Scroll one sample left.
      sampleValues.copyWithin(0, 1);
      sampleKinds.copyWithin(0, 1);

      const impulse = pending.current[0];
      if (impulse) {
        sampleValues[SAMPLES - 1] = impulse.values.shift() as number;
        sampleKinds[SAMPLES - 1] = impulse.kind;
        if (impulse.values.length === 0) pending.current.shift();
      } else {
        sampleValues[SAMPLES - 1] = 0;
        sampleKinds[SAMPLES - 1] = 0;
      }

      // Build the geometry here rather than during render: the buffers are refs
      // and must not be read while rendering.
      setSegments(buildSegments(sampleValues, sampleKinds));
    });
  }, [animated]);

  /*
   * With reduced motion there is no scrolling trace, but the information still
   * has to arrive: the line holds a static deflection whenever the most recent
   * poll was the one that brought new data, and drops back to flat on the next
   * unchanged poll. Derived rather than timed, so there is no animation and no
   * arbitrary duration - the spike stays exactly as long as it is true.
   */
  const staticSpike =
    lastPolledAt !== null && lastChangedAt !== null && lastChangedAt === lastPolledAt;

  const stroke =
    phase === "error" || phase === "paused"
      ? "var(--text-muted)"
      : "var(--signal-live)";

  return (
    <svg
      className={className}
      viewBox={`0 0 ${SAMPLES} ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      height={VIEW_HEIGHT}
      // The card states poll status in words next to this; a screen reader
      // gains nothing from the waveform itself.
      aria-hidden="true"
      focusable="false"
    >
      {/* Baseline rule. Present in every state so the trace has a datum. */}
      <line
        x1={0}
        y1={BASELINE}
        x2={SAMPLES}
        y2={BASELINE}
        stroke="var(--border)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />

      {!animated ? (
        <StaticTrace phase={phase} spike={staticSpike && phase !== "error"} />
      ) : (
        segments.map((segment, index) => (
          <polyline
            key={index}
            points={segment.points}
            fill="none"
            stroke={segment.kind === 1 ? "var(--signal-change)" : stroke}
            strokeWidth={segment.kind === 1 ? 1.75 : 1}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))
      )}
    </svg>
  );
}

/**
 * The non-animated trace: dashed and dim while polling is stopped or failing,
 * flat while idle, and holding a single spike shape just after a change when
 * the viewer has reduced motion on.
 */
function StaticTrace({ phase, spike }: { phase: PollPhase; spike: boolean }) {
  if (spike) {
    const mid = SAMPLES / 2;
    const points = [
      `0,${BASELINE}`,
      `${mid - 6},${BASELINE}`,
      `${mid - 3},${BASELINE + AMPLITUDE * 0.3}`,
      `${mid},${BASELINE - AMPLITUDE}`,
      `${mid + 3},${BASELINE + AMPLITUDE * 0.6}`,
      `${mid + 6},${BASELINE}`,
      `${SAMPLES},${BASELINE}`,
    ].join(" ");
    return (
      <polyline
        points={points}
        fill="none"
        stroke="var(--signal-change)"
        strokeWidth={1.75}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    );
  }

  const failing = phase === "error" || phase === "paused";
  return (
    <line
      x1={0}
      y1={BASELINE}
      x2={SAMPLES}
      y2={BASELINE}
      stroke={failing ? "var(--text-muted)" : "var(--signal-live)"}
      strokeWidth={failing ? 1.25 : 1}
      strokeDasharray={failing ? "3 3" : undefined}
      vectorEffect="non-scaling-stroke"
      opacity={failing ? 0.75 : 1}
    />
  );
}

interface Segment {
  points: string;
  kind: SampleKind;
}

/**
 * Split the ring buffer into runs of the same kind so a change deflection keeps
 * its own colour and weight as it scrolls away, instead of the whole trace
 * flashing orange.
 */
function buildSegments(values: Float32Array, kinds: Uint8Array): Segment[] {
  const segments: Segment[] = [];
  let currentKind: SampleKind = (kinds[0] as SampleKind) ?? 0;
  let points: string[] = [];

  for (let index = 0; index < values.length; index += 1) {
    const kind = (kinds[index] as SampleKind) ?? 0;
    const y = BASELINE - values[index] * AMPLITUDE;
    const point = `${index},${y.toFixed(2)}`;

    if (kind !== currentKind && points.length > 0) {
      // Repeat the boundary point in both runs so the line has no visible gap.
      points.push(point);
      segments.push({ points: points.join(" "), kind: currentKind });
      points = [point];
      currentKind = kind;
    } else {
      points.push(point);
    }
  }

  if (points.length > 0) segments.push({ points: points.join(" "), kind: currentKind });
  return segments;
}
