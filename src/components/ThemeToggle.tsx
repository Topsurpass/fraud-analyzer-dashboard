"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY, parseTheme, resolveTheme, type Theme } from "@/lib/theme";

/**
 * Light/dark switch. The current theme lives on <html data-theme>, which the
 * init script sets before paint; this reads it back rather than keeping a
 * second copy in state that could disagree with what is on screen.
 */
function subscribe(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", notify);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", notify);
  };
}

function current(): Theme {
  return resolveTheme(
    parseTheme(document.documentElement.getAttribute("data-theme")),
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
}

export function ThemeToggle() {
  // The server cannot know the theme, so it renders as light and the client
  // corrects on hydration; the icon is the only thing that differs.
  const theme = useSyncExternalStore(subscribe, current, () => "light" as Theme);
  const next: Theme = theme === "dark" ? "light" : "dark";

  function toggle() {
    const root = document.documentElement;
    root.classList.add("theme-switching");
    root.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice still applies for this page view.
    }
    window.setTimeout(() => root.classList.remove("theme-switching"), 260);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface text-secondary shadow-sm transition-colors hover:border-line-strong hover:text-ink"
    >
      <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        {theme === "dark" ? (
          <>
            <circle cx={8} cy={8} r={3} stroke="currentColor" strokeWidth={1.4} />
            <path
              d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinecap="round"
            />
          </>
        ) : (
          <path
            d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1Z"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinejoin="round"
          />
        )}
      </svg>
    </button>
  );
}
