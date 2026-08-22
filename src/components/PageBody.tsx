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
      <main className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">{children}</main>
    </>
  );
}
