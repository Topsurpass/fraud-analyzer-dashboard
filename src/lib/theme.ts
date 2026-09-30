/**
 * Theme choice: "light", "dark", or nothing stored, meaning follow the OS.
 *
 * Pure helpers plus the init script, so the rules are testable without a DOM.
 * The stylesheet does the actual theming from `data-theme` on <html>; with no
 * attribute it follows `prefers-color-scheme`.
 */
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "fae.theme";

export function parseTheme(value: string | null | undefined): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

/** What the screen is showing, given a stored choice and the OS preference. */
export function resolveTheme(stored: Theme | null, systemPrefersDark: boolean): Theme {
  return stored ?? (systemPrefersDark ? "dark" : "light");
}

/**
 * Inlined in <head>. Reads the stored choice and sets the attribute before
 * first paint. Storage can throw (private windows, blocked site data), so it
 * is wrapped: a failure means "follow the OS", never a broken page.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
