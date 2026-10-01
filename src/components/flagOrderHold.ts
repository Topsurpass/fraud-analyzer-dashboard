"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Reasons the board must not rearrange itself right now.
 *
 * Cards that move on their own are only welcome while nobody is using them. A
 * card that jumps out from under a click, or a menu whose card slides away, is
 * worse than an order that is a few seconds behind. So anything that takes the
 * person's attention (an open menu or dialog, an expanded card, a pointer held
 * down) takes a hold, and the board applies the order it has been waiting on the
 * moment the last hold ends. Holds count, so two at once do not release early.
 *
 * Module-level and shared by every board: a dialog is not about one grid.
 */

let holds = 0;
let pointerDown = false;
let listening = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Whether the board is currently held. Read at the moment of applying. */
export function isFlagOrderHeld(): boolean {
  return holds > 0 || pointerDown;
}

/** Take a hold. Returns the release, which is safe to call twice. */
export function holdFlagOrder(): () => void {
  holds += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    emit();
  };
}

function listenForPointer() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  const down = () => {
    pointerDown = true;
    emit();
  };
  const up = () => {
    if (!pointerDown) return;
    pointerDown = false;
    emit();
  };
  // Capture, so a handler that stops propagation cannot leave the board held.
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", up, true);
  window.addEventListener("blur", up);
}

export function subscribeFlagOrderHold(listener: () => void): () => void {
  listenForPointer();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Hold the board for as long as `active` is true. */
export function useHoldFlagOrder(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return holdFlagOrder();
  }, [active]);
}

/** Re-renders when a hold starts or ends. */
export function useFlagOrderHeld(): boolean {
  return useSyncExternalStore(subscribeFlagOrderHold, isFlagOrderHeld, () => false);
}

/** For tests: forget every hold and the pointer. */
export function resetFlagOrderHold(): void {
  holds = 0;
  pointerDown = false;
  emit();
}
