"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ConnectionsProvider } from "@/services/connections/ConnectionsContext";
import { DashboardsProvider } from "@/services/dashboards";
import { Rail } from "./Rail";

/** Lets a page's own TopBar open the mobile drawer that the shell owns. */
const NavContext = createContext<() => void>(() => {});

export function useOpenNav(): () => void {
  return useContext(NavContext);
}

/**
 * Widths of the desktop rail in each state, read from the tokens in
 * `globals.css` so the CSS and this component cannot drift apart.
 */
const RAIL_WIDTH = "var(--rail-width)";
const RAIL_WIDTH_COLLAPSED = "var(--rail-width-collapsed)";

/**
 * Rail plus content. The rail is permanent from `md` up and becomes a drawer
 * below it, which is the only responsive move the layout makes: the grid inside
 * the content area collapses on its own.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const [openNav] = useState(() => () => setNavOpen(true));
  /*
   * Session state rather than storage. The layout does not remount across
   * client-side navigation, so a collapsed rail stays collapsed while the
   * analyst moves around; only a full reload resets it.
   */
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  // A drawer that survived navigation would cover the page it just opened.
  const [navPath, setNavPath] = useState(pathname);
  if (pathname !== navPath) {
    setNavPath(pathname);
    if (navOpen) setNavOpen(false);
  }

  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navOpen]);

  return (
    <ConnectionsProvider>
      <DashboardsProvider>
      <div className="flex h-dvh min-h-0 w-full">
        <aside
          className="hidden shrink-0 border-r border-line transition-[width] duration-150 md:block"
          style={{ width: collapsed ? RAIL_WIDTH_COLLAPSED : RAIL_WIDTH }}
        >
          <Rail
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((value) => !value)}
          />
        </aside>

        {navOpen ? (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setNavOpen(false)}
              className="absolute inset-0 bg-bg/80"
            />
            <div className="absolute inset-y-0 left-0 w-[var(--rail-width)] max-w-[86vw] border-r border-line">
              <Rail onNavigate={() => setNavOpen(false)} />
            </div>
          </div>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <NavContext.Provider value={openNav}>{children}</NavContext.Provider>
        </div>
      </div>
      </DashboardsProvider>
    </ConnectionsProvider>
  );
}
