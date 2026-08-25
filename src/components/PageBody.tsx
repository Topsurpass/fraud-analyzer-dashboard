"use client";

import { TopBar, type Crumb } from "./TopBar";
import { useOpenNav } from "./AppShell";

/** Every page is a TopBar plus one scrolling region. */
export function PageBody({
  crumbs,
  actions,
  children,
}: {
  crumbs: Crumb[];
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const openNav = useOpenNav();

  return (
    <>
      <TopBar crumbs={crumbs} actions={actions} onOpenNav={openNav} />
      {/* The shell is where the whitespace lives; data surfaces inside stay
          dense. See .data-dense in globals.css. */}
      <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
    </>
  );
}
