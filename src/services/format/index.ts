/**
 * Deterministic formatting for every number, timestamp and hash the dashboard
 * renders. Pure functions only: same input, same output, no `Date.now()` reads
 * inside. Callers pass `now` so relative times stay testable and so server and
 * client never disagree during hydration.
 */

const COMPACT_UNITS = [
  { limit: 1e12, suffix: "T" },
  { limit: 1e9, suffix: "B" },
  { limit: 1e6, suffix: "M" },
  { limit: 1e3, suffix: "K" },
] as const;

/** Group digits without locale drift: 1234567 -> "1,234,567". */
export function formatInteger(value: number): string {
  if (!Number.isFinite(value)) return "--";
  const negative = value < 0;
  const digits = Math.abs(Math.trunc(value)).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${grouped}` : grouped;
}

/**
 * Big-number card readout. Keeps four significant characters of information
 * and never renders more precision than the value carries.
 */
export function formatMetric(value: number, options: { compact?: boolean } = {}): string {
  if (!Number.isFinite(value)) return "--";
  const magnitude = Math.abs(value);

  if (options.compact !== false) {
    for (const unit of COMPACT_UNITS) {
      if (magnitude >= unit.limit) {
        const scaled = value / unit.limit;
        const decimals = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
        return `${trimZeros(scaled.toFixed(decimals))}${unit.suffix}`;
      }
    }
  }

  if (Number.isInteger(value)) return formatInteger(value);
  if (magnitude >= 100) return trimZeros(value.toFixed(1));
  if (magnitude >= 1) return trimZeros(value.toFixed(2));
  if (magnitude === 0) return "0";
  return trimZeros(value.toPrecision(3));
}

function trimZeros(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/** Axis tick labels: tighter than `formatMetric`, always compact. */
export function formatAxisValue(value: number): string {
  if (!Number.isFinite(value)) return "";
  const magnitude = Math.abs(value);
  if (magnitude >= 1e3) return formatMetric(value, { compact: true });
  if (Number.isInteger(value)) return formatInteger(value);
  if (magnitude >= 1) return trimZeros(value.toFixed(1));
  return trimZeros(value.toPrecision(2));
}

/** Query duration readout. Sub-second stays in ms; past that, seconds. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "--";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${trimZeros((ms / 1000).toFixed(2))}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

/** 24-hour wall clock with seconds: the only time format on a trading floor. */
export function formatClock(iso: string | null | undefined): string {
  const date = parseIso(iso);
  if (!date) return "--:--:--";
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => part.toString().padStart(2, "0"))
    .join(":");
}

export function formatDateTime(iso: string | null | undefined): string {
  const date = parseIso(iso);
  if (!date) return "--";
  const yyyy = date.getFullYear();
  const mm = (date.getMonth() + 1).toString().padStart(2, "0");
  const dd = date.getDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${formatClock(iso)}`;
}

/**
 * "how long since" readout for the live status line. Deliberately coarse past a
 * minute: an analyst cares about "4s ago" and "stale", not "73s ago".
 */
export function formatRelative(iso: string | null | undefined, now: number): string {
  const date = parseIso(iso);
  if (!date) return "never";
  const deltaMs = now - date.getTime();
  if (deltaMs < 0) return "0s ago";
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Data hashes are long; show enough to eyeball a change, not the whole digest.
 * The engine prefixes its digests with the algorithm ("sha256:abc..."), which
 * carries no information once every hash uses the same one, so it is dropped.
 */
export function formatHash(hash: string | null | undefined, length = 8): string {
  if (!hash) return "-".repeat(length);
  const digest = hash.includes(":") ? hash.slice(hash.indexOf(":") + 1) : hash;
  return digest.length <= length ? digest : digest.slice(0, length);
}

/** Poll cadence readout: "2.5s" reads faster than "2500ms". */
export function formatInterval(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "--";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${trimZeros((ms / 1000).toFixed(1))}s`;
}

/** Render an arbitrary result cell for the table view. Never returns "[object Object]". */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isInteger(value) ? formatInteger(value) : formatMetric(value, { compact: false });
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  // FastAPI emits naive ISO strings for UTC datetimes; treat them as UTC so
  // "last updated" never jumps by the local offset.
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export { parseIso };

/** Acronyms and currency codes that should stay upper-case in a label. */
const KEEP_UPPER = new Set([
  "id", "usd", "eur", "gbp", "ngn", "url", "uri", "ip", "sql", "api", "utc", "avg", "sum",
  "min", "max", "pct", "kyc", "atm", "pos", "iban", "bin", "mcc",
]);

/**
 * Turn a database column name into something a person reads.
 *
 * A card that labels its readout `exposure_usd` is showing the analyst the
 * schema rather than the number's meaning. Splitting on underscores and
 * camelCase covers every naming convention this app actually meets, and the
 * acronym list stops "usd" becoming "Usd", which reads worse than the raw
 * column did.
 */
export function humanizeColumn(name: string): string {
  const words = name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean);

  if (words.length === 0) return name;

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (KEEP_UPPER.has(lower)) return lower.toUpperCase();
      // Something like SUM(AMOUNT) or a name that is already shouting stays as
      // written; re-casing it would lose information the analyst put there.
      if (word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word)) return word;
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}
