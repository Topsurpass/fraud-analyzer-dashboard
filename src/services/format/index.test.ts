import { describe, expect, it } from "vitest";
import {
  formatAxisValue,
  formatCell,
  formatClock,
  formatDuration,
  formatHash,
  formatInteger,
  formatInterval,
  formatMetric,
  formatRelative,
  humanizeColumn,
  parseIso,
} from "./index";

describe("formatInteger", () => {
  it("groups thousands", () => {
    expect(formatInteger(0)).toBe("0");
    expect(formatInteger(999)).toBe("999");
    expect(formatInteger(1000)).toBe("1,000");
    expect(formatInteger(1234567)).toBe("1,234,567");
  });

  it("keeps the sign outside the grouping", () => {
    expect(formatInteger(-1234567)).toBe("-1,234,567");
  });

  it("renders non-finite input as the missing-data glyph", () => {
    expect(formatInteger(Number.NaN)).toBe("--");
    expect(formatInteger(Number.POSITIVE_INFINITY)).toBe("--");
  });
});

describe("formatMetric", () => {
  it("compacts at each magnitude boundary", () => {
    expect(formatMetric(999)).toBe("999");
    expect(formatMetric(1000)).toBe("1K");
    expect(formatMetric(1500)).toBe("1.5K");
    expect(formatMetric(12345)).toBe("12.3K");
    expect(formatMetric(999999)).toBe("1000K");
    expect(formatMetric(1_000_000)).toBe("1M");
    expect(formatMetric(2_400_000_000)).toBe("2.4B");
    expect(formatMetric(3_100_000_000_000)).toBe("3.1T");
  });

  it("drops trailing zeros rather than padding", () => {
    expect(formatMetric(2_000_000)).toBe("2M");
    expect(formatMetric(1.5)).toBe("1.5");
  });

  it("keeps precision for small values", () => {
    expect(formatMetric(0)).toBe("0");
    expect(formatMetric(0.042)).toBe("0.042");
    expect(formatMetric(12.345)).toBe("12.35");
    expect(formatMetric(456.789)).toBe("456.8");
  });

  it("can be forced to stay uncompacted", () => {
    expect(formatMetric(1234567, { compact: false })).toBe("1,234,567");
  });

  it("handles negatives symmetrically", () => {
    expect(formatMetric(-1500)).toBe("-1.5K");
  });
});

describe("formatAxisValue", () => {
  it("stays terse enough for a tick label", () => {
    expect(formatAxisValue(1200)).toBe("1.2K");
    expect(formatAxisValue(42)).toBe("42");
    expect(formatAxisValue(4.25)).toBe("4.3");
    expect(formatAxisValue(0.125)).toBe("0.13");
  });
});

describe("formatDuration", () => {
  it("switches units at a second and a minute", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(12)).toBe("12ms");
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(59_999)).toBe("60s");
    expect(formatDuration(61_000)).toBe("1m 01s");
  });

  it("renders absent durations rather than NaN", () => {
    expect(formatDuration(null)).toBe("--");
    expect(formatDuration(undefined)).toBe("--");
  });
});

describe("parseIso", () => {
  it("treats a naive FastAPI datetime as UTC", () => {
    // Without the UTC assumption these two would differ by the local offset.
    expect(parseIso("2026-08-22T13:25:48")?.getTime()).toBe(
      parseIso("2026-08-22T13:25:48Z")?.getTime(),
    );
  });

  it("respects an explicit offset", () => {
    expect(parseIso("2026-08-22T13:25:48+02:00")?.toISOString()).toBe(
      "2026-08-22T11:25:48.000Z",
    );
  });

  it("returns null for junk", () => {
    expect(parseIso("not a date")).toBeNull();
    expect(parseIso(null)).toBeNull();
  });
});

describe("formatClock", () => {
  it("zero-pads to a fixed width so the readout never reflows", () => {
    const iso = new Date(2026, 7, 22, 9, 5, 3).toISOString();
    expect(formatClock(iso)).toBe("09:05:03");
    expect(formatClock(null)).toBe("--:--:--");
  });
});

describe("formatRelative", () => {
  const base = Date.parse("2026-08-22T12:00:00Z");

  it("counts seconds, then minutes, then hours, then days", () => {
    expect(formatRelative("2026-08-22T11:59:56Z", base)).toBe("4s ago");
    expect(formatRelative("2026-08-22T11:57:00Z", base)).toBe("3m ago");
    expect(formatRelative("2026-08-22T09:00:00Z", base)).toBe("3h ago");
    expect(formatRelative("2026-08-20T12:00:00Z", base)).toBe("2d ago");
  });

  it("clamps clock skew instead of printing a negative age", () => {
    expect(formatRelative("2026-08-22T12:00:05Z", base)).toBe("0s ago");
  });

  it("says never when nothing has run", () => {
    expect(formatRelative(null, base)).toBe("never");
  });
});

describe("formatHash", () => {
  it("drops the algorithm prefix the engine sends", () => {
    expect(formatHash("sha256:0fdc5a0df1122334455")).toBe("0fdc5a0d");
  });

  it("keeps short hashes intact and pads absence", () => {
    expect(formatHash("abc")).toBe("abc");
    expect(formatHash(null)).toBe("--------");
  });
});

describe("formatInterval", () => {
  it("reads as seconds past a second", () => {
    expect(formatInterval(500)).toBe("500ms");
    expect(formatInterval(3000)).toBe("3s");
    expect(formatInterval(4500)).toBe("4.5s");
    expect(formatInterval(null)).toBe("--");
  });
});

describe("formatCell", () => {
  it("makes NULL explicit rather than blank", () => {
    expect(formatCell(null)).toBe("NULL");
    expect(formatCell(undefined)).toBe("NULL");
  });

  it("passes strings through untouched", () => {
    expect(formatCell("suspected_fraud")).toBe("suspected_fraud");
    expect(formatCell("")).toBe("");
  });

  it("never compacts a cell value, since the table is the audit view", () => {
    expect(formatCell(1234567)).toBe("1,234,567");
    expect(formatCell(1234.5)).toBe("1234.5");
  });

  it("renders booleans and objects legibly", () => {
    expect(formatCell(true)).toBe("true");
    expect(formatCell({ a: 1 })).toBe('{"a":1}');
  });
});

describe("humanizeColumn", () => {
  it("turns a snake_case column into a label", () => {
    expect(humanizeColumn("exposure_usd")).toBe("Exposure USD");
    expect(humanizeColumn("last_tested_at")).toBe("Last tested at");
  });

  it("splits camelCase too", () => {
    expect(humanizeColumn("declineCount")).toBe("Decline count");
  });

  it("keeps acronyms and currency codes upper-case", () => {
    // "Usd" reads worse than the raw column did, which would make the whole
    // exercise a downgrade.
    expect(humanizeColumn("total_usd")).toBe("Total USD");
    expect(humanizeColumn("merchant_id")).toBe("Merchant ID");
  });

  it("leaves a name the analyst already shouted alone", () => {
    // SUM(AMOUNT) is the analyst's own SQL; re-casing it loses information.
    expect(humanizeColumn("SUM(AMOUNT)")).toBe("SUM(AMOUNT)");
  });

  it("returns the input when there is nothing to split", () => {
    expect(humanizeColumn("")).toBe("");
    expect(humanizeColumn("__")).toBe("__");
  });
});
