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
      {/* `relative`: absolute descendants (every `sr-only` caption and label) are
          positioned against, and clipped by, this scroller instead of the body.
          The shell is where the whitespace lives; data surfaces inside stay
          dense. See .data-dense in globals.css. */}
      <main className="relative min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        {/* No width cap: content takes whatever the sidebar leaves. A 1600px cap,
            centred, left empty bands on both sides of a wide screen, and they
            doubled in size when the sidebar collapsed. Pages that should stay
            narrow (forms) cap themselves; the card grid adds columns instead. */}
        <div className="w-full">{children}</div>
      </main>
    </>
  );
}
