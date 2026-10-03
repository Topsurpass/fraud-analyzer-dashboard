import type { ReactNode } from "react";
import { Panel } from "./ui";

/**
 * A `Panel`, or just its contents.
 *
 * The chart and rule editors each came with their own framed panel, which suits a
 * page that stacks them but doubles every border once a page supplies its own card
 * (the query builder) or hosts one in a dialog. `bare` drops the frame and the
 * title and keeps the actions as a plain row above the content, so the same
 * editor sits in either place without a second copy of it.
 */
export function PanelFrame({
  bare = false,
  title,
  actions,
  children,
}: {
  bare?: boolean;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  if (!bare) {
    return (
      <Panel title={title} actions={actions}>
        {children}
      </Panel>
    );
  }
  return (
    <div>
      {actions ? (
        <div className="flex flex-wrap items-center justify-end gap-2 px-4 pt-3">{actions}</div>
      ) : null}
      {children}
    </div>
  );
}
