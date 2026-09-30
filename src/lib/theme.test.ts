import { describe, expect, it } from "vitest";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY, parseTheme, resolveTheme } from "./theme";

describe("theme", () => {
  it("accepts only the two real themes", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("solarized")).toBeNull();
    expect(parseTheme(null)).toBeNull();
    expect(parseTheme(undefined)).toBeNull();
  });

  it("lets a stored choice beat the OS, and falls back to the OS otherwise", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("init script applies a stored theme and survives throwing storage", () => {
    const run = (getItem: () => string | null) => {
      const attrs: Record<string, string> = {};
      const localStorage = { getItem };
      const document = {
        documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) },
      };
      new Function("localStorage", "document", THEME_INIT_SCRIPT)(localStorage, document);
      return attrs;
    };
    expect(run(() => "dark")).toEqual({ "data-theme": "dark" });
    expect(run(() => "garbage")).toEqual({});
    expect(run(() => null)).toEqual({});
    expect(run(() => { throw new Error("blocked"); })).toEqual({});
    expect(THEME_INIT_SCRIPT).toContain(THEME_STORAGE_KEY);
  });
});
