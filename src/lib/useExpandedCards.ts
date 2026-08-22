"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * Which cards are currently showing their larger footprint.
 *
 * Session state, not storage: expanding a card is a momentary "let me look at
 * this one properly" gesture, not a saved preference, and a grid that came back
 * from a reload in a shape the analyst set days ago would be more surprising
 * than useful.
 */
export interface ExpandedCards {
  isExpanded: (id: string) => boolean;
  toggle: (id: string) => void;
  /** True when at least one card is expanded. */
  any: boolean;
  collapseAll: () => void;
}

export function useExpandedCards(): ExpandedCards {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());

  const toggle = useCallback((id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => setExpanded(new Set<string>()), []);

  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded]);

  return useMemo(
    () => ({ isExpanded, toggle, any: expanded.size > 0, collapseAll }),
    [isExpanded, toggle, expanded.size, collapseAll],
  );
}
