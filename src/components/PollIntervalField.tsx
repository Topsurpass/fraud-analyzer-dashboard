"use client";

import { useState } from "react";
import { describeDuration } from "@/services/format";
import { Field, Input, Select } from "@/components/ui";

/**
 * The interval at which a saved query runs on its database.
 *
 * Held as the raw milliseconds the engine stores, but asked for the way people say
 * it ("every 5 minutes") and stated back in words: a field that takes 3600000 makes
 * "is that an hour?" the user's arithmetic. The hint also says what the setting actually controls. It
 * is not how often a card refreshes: it is the most often the query is run
 * against the database, however many people or tabs have it open. Opening or
 * leaving a page does not run it; a viewer is served the last result until the
 * interval has passed.
 */
const PRESETS: { label: string; ms: number }[] = [
  { label: "1 min", ms: 60_000 },
  { label: "5 min", ms: 300_000 },
  { label: "15 min", ms: 900_000 },
  { label: "1 hour", ms: 3_600_000 },
  { label: "1 day", ms: 86_400_000 },
];

const UNITS = [
  { id: "seconds", label: "seconds", ms: 1_000 },
  { id: "minutes", label: "minutes", ms: 60_000 },
  { id: "hours", label: "hours", ms: 3_600_000 },
  { id: "days", label: "days", ms: 86_400_000 },
] as const;
type UnitId = (typeof UNITS)[number]["id"];

/** The biggest unit that divides the interval evenly. */
function bestFit(ms: number): (typeof UNITS)[number] {
  return [...UNITS].reverse().find((unit) => ms % unit.ms === 0) ?? UNITS[0];
}

/**
 * The wanted unit while it divides the interval evenly, else the biggest unit that does.
 * Sticky on purpose: typing "60" in minutes must not flip to "1 hour" under the cursor.
 */
function unitFor(ms: number | null, wanted: UnitId): (typeof UNITS)[number] {
  const preferred = UNITS.find((unit) => unit.id === wanted)!;
  if (ms === null || ms === 0 || ms % preferred.ms === 0) return preferred;
  return bestFit(ms);
}

export function PollIntervalField({
  value,
  onChange,
  id = "query-poll",
  readout = true,
}: {
  /** The milliseconds as digits; empty means "use the engine's default". */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  /** The sentence under the field. Off when the host already says it in its heading. */
  readout?: boolean;
}) {
  const ms = value === "" ? null : Number(value);
  const [wanted, setWanted] = useState<UnitId>("minutes");
  const unit = unitFor(ms, wanted);
  const shown = ms === null ? "" : String(ms / unit.ms);
  return (
    <Field
      label="Run every"
      htmlFor={id}
      hint="The most often this query runs on the database, however many people or tabs have it open. Opening or leaving a page never runs it: viewers see the last result until the interval has passed. Blank uses the engine's default."
    >
      <div className="flex gap-2">
        <Input
          id={id}
          value={shown}
          inputMode="numeric"
          onChange={(event) => {
            const digits = event.target.value.replace(/[^\d]/g, "");
            onChange(digits === "" ? "" : String(Number(digits) * unit.ms));
          }}
          placeholder="5"
          className="tnum w-28"
        />
        <Select
          aria-label="Unit of time"
          value={unit.id}
          onChange={(event) => {
            const next = UNITS.find((entry) => entry.id === event.target.value)!;
            setWanted(next.id);
            // Keep the number the person typed, in the new unit.
            if (ms !== null) onChange(String((ms / unit.ms) * next.ms));
          }}
          className="w-32"
        >
          {UNITS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </Select>
      </div>
      {readout ? (
        <p aria-live="polite" className="tnum mt-1.5 text-[12.5px] text-muted">
          {ms === null
            ? "Using the engine's default."
            : ms === 0
              ? "Enter a number above zero."
              : `Runs at most once every ${describeDuration(ms)}.`}
        </p>
      ) : ms === 0 ? (
        <p role="alert" className="mt-1.5 text-[12.5px] text-change">
          Enter a number above zero.
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Common intervals">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => {
              setWanted(bestFit(preset.ms).id);
              onChange(String(preset.ms));
            }}
            aria-pressed={ms === preset.ms}
            className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
              ms === preset.ms
                ? "border-accent/40 bg-accent-soft text-accent"
                : "border-line bg-surface text-secondary hover:border-line-strong hover:text-ink"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </Field>
  );
}
