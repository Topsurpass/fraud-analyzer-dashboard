"use client";

import { describeDuration } from "@/services/format";
import { Field, Input } from "@/components/ui";

/**
 * The interval at which a saved query runs on its database.
 *
 * Held as the raw milliseconds the engine stores, but stated back in words: a
 * field that takes 3600000 and says nothing else makes "is that an hour?" the
 * user's arithmetic. The hint also says what the setting actually controls. It
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

export function PollIntervalField({
  value,
  onChange,
  id = "query-poll",
}: {
  /** The digits typed so far; empty means "use the engine's default". */
  value: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  const ms = value === "" ? null : Number(value);
  return (
    <Field
      label="Poll interval (ms)"
      htmlFor={id}
      hint="The most often this query runs on the database, however many people or tabs have it open. Opening or leaving a page never runs it: viewers see the last result until the interval has passed. Blank uses the engine's default."
    >
      <Input
        id={id}
        value={value}
        inputMode="numeric"
        onChange={(event) => onChange(event.target.value.replace(/[^\d]/g, ""))}
        placeholder="5000"
        className="tnum"
      />
      <p aria-live="polite" className="tnum mt-1.5 text-[12.5px] text-muted">
        {ms === null
          ? "Using the engine's default."
          : ms === 0
            ? "Enter a number of milliseconds above zero."
            : `Runs at most once every ${describeDuration(ms)}.`}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Common intervals">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onChange(String(preset.ms))}
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
