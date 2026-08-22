import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useExpandedCards } from "./useExpandedCards";

describe("useExpandedCards", () => {
  it("starts with everything at its default size", () => {
    const { result } = renderHook(() => useExpandedCards());
    expect(result.current.isExpanded("q1")).toBe(false);
    expect(result.current.any).toBe(false);
  });

  it("toggles a single card without touching the others", () => {
    const { result } = renderHook(() => useExpandedCards());

    act(() => result.current.toggle("q1"));
    expect(result.current.isExpanded("q1")).toBe(true);
    expect(result.current.isExpanded("q2")).toBe(false);
    expect(result.current.any).toBe(true);

    act(() => result.current.toggle("q1"));
    expect(result.current.isExpanded("q1")).toBe(false);
    expect(result.current.any).toBe(false);
  });

  it("allows several cards to be expanded at once", () => {
    const { result } = renderHook(() => useExpandedCards());
    act(() => result.current.toggle("q1"));
    act(() => result.current.toggle("q2"));

    expect(result.current.isExpanded("q1")).toBe(true);
    expect(result.current.isExpanded("q2")).toBe(true);
  });

  it("collapses everything at once", () => {
    const { result } = renderHook(() => useExpandedCards());
    act(() => result.current.toggle("q1"));
    act(() => result.current.toggle("q2"));

    act(() => result.current.collapseAll());
    expect(result.current.any).toBe(false);
  });
});
