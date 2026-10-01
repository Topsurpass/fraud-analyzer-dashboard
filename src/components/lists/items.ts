import type { ItemListSummary, ListUsage, UserRead } from "@/contracts/api";
import { ApiError } from "@/services/api-client";

/** The engine refuses an item longer than this, so the form says so first. */
export const MAX_ITEM_LENGTH = 500;
export const MAX_NAME_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 1000;

/**
 * Split pasted text into items.
 *
 * If the text has any newline, only newlines separate items, so an entry like
 * "Smith, John" survives a paste of one name per line. With no newline the text
 * is a hand-typed line and commas separate items. Blank entries are skipped so
 * a trailing newline or a doubled comma is not an item.
 */
export function parseItems(text: string): string[] {
  return text
    .split(/[\r\n]/.test(text) ? /\r?\n/ : ",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Decimal literals only, as Python's `Decimal` reads them: optional sign,
 * digits with an optional point, optional exponent, and single underscores
 * between digits. Hex ("0x1A"), "Infinity", "NaN" and the empty string are not
 * numbers, which is where JavaScript's `Number()` disagrees with the engine.
 */
const DECIMAL = /^([+-]?)(\d+(?:_\d+)*)?(?:\.(\d+(?:_\d+)*)?)?(?:[eE]([+-]?\d+))?$/;

/**
 * A number's canonical form: sign, significant digits and a power of ten, with
 * trailing zeros folded into the power. Strings rather than floats so that
 * 12345678901234567890 and ...891 stay different and 1e999 costs nothing.
 * Zero, whatever its sign or spelling, is "0".
 */
function decimalKey(text: string): string | null {
  const match = DECIMAL.exec(text);
  if (!match) return null;
  const [, sign, whole = "", fraction = "", exponent = "0"] = match;
  if (whole === "" && fraction === "") return null;
  const wholeDigits = whole.replaceAll("_", "");
  const fractionDigits = fraction.replaceAll("_", "");
  let digits = (wholeDigits + fractionDigits).replace(/^0+/, "");
  if (digits === "") return "0";
  let power = Number(exponent) - fractionDigits.length;
  const trimmed = digits.replace(/0+$/, "");
  power += digits.length - trimmed.length;
  digits = trimmed;
  return `${sign === "-" ? "-" : ""}${digits}e${power}`;
}

/**
 * The comparison key the form uses to predict duplicates.
 *
 * Mirrors the engine's `list_key` (trimmed, case-folded text; decimal numbers
 * compare by value) so the count under the box matches what the save reports.
 * The engine stays the authority: this only sets expectations before the
 * round trip. Case folding is approximated by upper-then-lower, which also
 * maps "ß" to "ss" as `casefold` does.
 */
export function itemKey(item: string): string {
  const text = item.trim();
  const number = decimalKey(text);
  if (number !== null) return `n:${number}`;
  return `s:${text.toUpperCase().toLowerCase()}`;
}

export interface ItemTally {
  received: number;
  kept: number;
  duplicates: number;
  /** Items over `MAX_ITEM_LENGTH`; the engine would reject the save. */
  tooLong: number;
}

export function tallyItems(items: readonly string[]): ItemTally {
  const seen = new Set<string>();
  let tooLong = 0;
  for (const item of items) {
    seen.add(itemKey(item));
    if (item.length > MAX_ITEM_LENGTH) tooLong += 1;
  }
  return {
    received: items.length,
    kept: seen.size,
    duplicates: items.length - seen.size,
    tooLong,
  };
}

/**
 * Whether this person may change or delete the list.
 *
 * Everyone may read and use every list, but the engine lets only the creator
 * or an administrator write, and answers 403 FORBIDDEN to anyone else. Offering
 * the controls to the wrong person would be an action that always fails.
 */
export function mayEditList(
  list: Pick<ItemListSummary, "created_by">,
  user: UserRead | null,
): boolean {
  if (!user) return false;
  return user.role === "admin" || list.created_by === user.id;
}

export interface ListBlockers {
  /** Rules on queries the caller can see. */
  rules: ListUsage[];
  /** Rules on queries the caller cannot see, counted but not named. */
  hidden: number;
}

/**
 * The rules blocking a delete, from a 409 `LIST_IN_USE`.
 *
 * Read defensively: the detail is engine-controlled JSON typed `unknown`, and
 * a malformed one should degrade to the plain message, not throw in a handler.
 * `rules` can be empty with `hidden` above zero: a list used only by other
 * people's queries is still in use.
 */
export function usageFromError(error: unknown): ListBlockers {
  const none: ListBlockers = { rules: [], hidden: 0 };
  if (!(error instanceof ApiError) || error.errorCode !== "LIST_IN_USE") return none;
  const detail = error.detail as { rules?: unknown; hidden_rule_count?: unknown } | null;
  if (!detail) return none;
  const hidden =
    typeof detail.hidden_rule_count === "number" &&
    Number.isInteger(detail.hidden_rule_count) &&
    detail.hidden_rule_count > 0
      ? detail.hidden_rule_count
      : 0;
  const rules = Array.isArray(detail.rules)
    ? detail.rules.flatMap((entry): ListUsage[] => {
        if (!entry || typeof entry !== "object") return [];
        const { rule_name, query_id, query_name } = entry as Partial<ListUsage>;
        if (typeof rule_name !== "string" || typeof query_id !== "string") return [];
        return [{ rule_name, query_id, query_name: query_name ?? "" }];
      })
    : [];
  return { rules, hidden };
}

/** One line for a failed save or delete. */
export function listErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.errorCode === "LIST_NAME_TAKEN") {
      return "Another list already has that name. Names are not case sensitive.";
    }
    return error.displayMessage;
  }
  return fallback;
}

/**
 * A query save or preview error, with the unknown-list case put in terms of
 * what to do. The engine's own message is "No list with id '<uuid>'", which
 * names neither the rule nor the fix.
 */
export function queryErrorMessage(error: ApiError): string {
  if (error.errorCode === "LIST_NOT_FOUND") {
    return "A rule uses a list that no longer exists. Pick another list.";
  }
  return error.displayMessage;
}
