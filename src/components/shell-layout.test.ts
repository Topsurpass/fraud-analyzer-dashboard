import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Three layout bugs that jsdom cannot see, held by the classes that fix them.
 * `scripts/check-layout.mjs` measures the real thing in a browser; this is the
 * free, every-commit half, in the style of `max-height-clips.test.ts`.
 *
 *  1. The notification bell's panel sat under the chart cards and took no
 *     clicks. The header (a `backdrop-blur` stacking context at the bottom of
 *     the order) must be raised above the page.
 *  2. The shell must be exactly the viewport and clip, so the page scrolls in
 *     `main` and the sidebar is a column that cannot be carried along.
 *  3. A popover panel positioned by its caller (`absolute`) is clipped by the
 *     first `overflow-hidden` ancestor; `Popover` places its own panel.
 */

const SRC = join(process.cwd(), "src/components");
const read = (name: string) => readFileSync(join(SRC, name), "utf8");

/** The class list of the first element whose opening tag contains `anchor`. */
function classesOf(source: string, anchor: string): string[] {
  const at = source.indexOf(anchor);
  expect(at, `"${anchor}" not found`).toBeGreaterThan(-1);
  const rest = source.slice(at);
  const match = rest.match(/className="([^"]*)"/);
  expect(match, `no className after "${anchor}"`).not.toBeNull();
  return match![1].split(/\s+/);
}

describe("header stacking", () => {
  const header = classesOf(read("TopBar.tsx"), "<header");

  it("is raised above the page content", () => {
    expect(header).toContain("relative");
    expect(header).toContain("z-40");
  });

  it("stays below the mobile drawer", () => {
    const shell = read("AppShell.tsx");
    expect(shell).toContain("fixed inset-0 z-50");
  });
});

describe("the shell", () => {
  const shell = read("AppShell.tsx");

  it("is the viewport and clips, so the document never scrolls", () => {
    const classes = classesOf(shell, '<div className="flex h-dvh');
    expect(classes).toContain("h-dvh");
    expect(classes).toContain("overflow-hidden");
  });

  it("holds the sidebar to a fixed-height, clipped column", () => {
    const classes = classesOf(shell, "<aside");
    expect(classes).toContain("h-full");
    expect(classes).toContain("overflow-hidden");
  });

  it("scrolls only inside main", () => {
    expect(classesOf(read("PageBody.tsx"), "<main")).toContain("overflow-y-auto");
  });
});

describe("the bell panel", () => {
  it("spans the header on a phone and hangs from the bell from `sm` up", () => {
    const bell = read("FlaggedBell.tsx");
    const panel = classesOf(bell, 'role="menu"');
    expect(panel).toContain("inset-x-3");
    expect(panel).toContain("sm:right-0");
    expect(panel).toContain("sm:w-72");
    // Its container must not be the positioning parent below `sm`.
    expect(bell).toContain('className="sm:relative"');
  });
});

describe("popover panels", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [path] : [];
    });
  }

  it("no caller positions its own panel", () => {
    const offenders = sourceFiles(join(process.cwd(), "src"))
      .filter((file) => !file.endsWith("Popover.tsx"))
      .flatMap((file) => {
        const source = readFileSync(file, "utf8");
        return [...source.matchAll(/panelClassName="([^"]*)"/g)]
          .filter((m) => /(^|\s)(absolute|fixed|top-full)(\s|$)/.test(m[1]))
          .map(() => file);
      });
    expect(offenders).toEqual([]);
  });
});
