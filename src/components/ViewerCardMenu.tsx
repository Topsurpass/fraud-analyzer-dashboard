"use client";

import { useRef, useState } from "react";
import { DefinitionDialog } from "./DefinitionDialog";
import { MenuButton } from "./CardMenu";
import { Popover } from "./Popover";

/**
 * The menu on somebody else's published chart.
 *
 * The owner's menu changes the query, runs it, publishes it and deletes it. A
 * viewer may do none of that, so this one holds a single item, View definition,
 * and nothing in it can modify anything. It exists so the way to learn how a
 * chart was made is a visible control on the card rather than something to guess
 * at.
 *
 * The dialog's state lives out here, above the popover. The popover unmounts its
 * panel the moment it closes, and a dialog owned by the panel would vanish with
 * it.
 */
export function ViewerCardMenu({ chartId, name }: { chartId: string; name: string }) {
  const [viewing, setViewing] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);

  const closeDialog = () => {
    setViewing(false);
    // A dialog hands focus back to what opened it, and that was a menu item in
    // a panel that has since unmounted, so focus would fall to the page. The
    // menu's own button is the nearest thing that still exists.
    queueMicrotask(() => wrapper.current?.querySelector("summary")?.focus());
  };

  return (
    <span ref={wrapper} className="contents">
      <Popover
        label={`Chart options for ${name}`}
        title="Chart options"
        trigger={<span aria-hidden="true">⋯</span>}
        triggerClassName="grid size-7 cursor-pointer list-none place-items-center rounded-md text-[15px] leading-none text-muted transition-colors hover:bg-raised hover:text-ink"
        panelClassName="w-56 rounded-[var(--radius)] border border-line bg-surface py-1.5 shadow-lg"
      >
        <MenuButton
          onClick={() => setViewing(true)}
          title="Read the query and settings behind this chart, and copy them to build your own."
        >
          View definition
        </MenuButton>
      </Popover>
      <DefinitionDialog chartId={viewing ? chartId : null} onClose={closeDialog} />
    </span>
  );
}
