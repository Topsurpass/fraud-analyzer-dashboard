import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A height cap that clips nothing is not a cap.
 *
 * The bug: the query editor's preview panel was `max-h-80` and nothing else.
 * `max-height` bounds the element's own box but does not clip what is inside
 * it, so a 100-row preview drew straight down over the Flag rules panel below
 * - heading, help text and the "No rules yet" box, all with table rows printed
 * across them. The class looked like it capped the panel. It only capped the
 * border.
 *
 * jsdom has no layout, so no rendering test can catch this: a table that
 * overflows its parent and one that scrolls inside it produce identical DOM.
 * The real-browser check lives in `scripts/smoke.mjs`. What CAN be checked for
 * free, on every commit, is the rule the bug broke - and checked for the whole
 * repo rather than the one component that got it wrong, because the next place
 * someone writes `max-h-` is not this file.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

/**
 * Comments out. This rule reads code, not prose - and prose about the rule
 * quotes the very class names it is looking for, which is exactly how this
 * check first failed on its own docstring. Block comments and whole-line `//`
 * comments only, so a `//` inside a string (a URL) is left alone.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Every quoted run of class names in a file. Crude on purpose: a class list is
 * a string literal, and a rule that only understands one authoring style would
 * quietly stop covering the file that switched styles.
 */
function classLists(source: string): string[] {
  return (source.match(/(["'`])[^"'`\n]*\1/g) ?? [])
    .map((literal) => literal.slice(1, -1))
    .filter((value) => /(^|\s)(max-h-|h-|flex|grid|overflow-)/.test(value));
}

describe("a max-height must clip what it caps", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles(SRC)) {
    for (const list of classLists(withoutComments(readFileSync(file, "utf8")))) {
      if (!/(^|\s)max-h-/.test(list)) continue;
      // The cap must say what happens to the overflow, whether that is scroll,
      // auto or hidden. `overflow-hidden` on a flex column is how the preview
      // panel does it: hidden on the wrapper, and the table inside it shrinks
      // to the cap and scrolls on its own.
      const clips = /(^|\s)overflow-/.test(list);
      if (!clips) offenders.push(`${file.replace(process.cwd() + "/", "")}: "${list}"`);
    }
  }

  it("pairs every max-h- class with an overflow- class", () => {
    expect(offenders).toEqual([]);
  });
});
