/**
 * Shown while a navigation is resolving.
 *
 * Every page in this segment unwraps `params` with `use`, which suspends on
 * first render. Without a boundary here React had nowhere to show that, so a
 * navigation froze on the *previous* page: clicking Save left the form on
 * screen with its button stuck on "Saving…" and no indication anything was
 * happening. The save had already succeeded.
 */
export default function Loading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 sm:p-6">
      <div className="skeleton-sweep h-6 w-48 rounded-[var(--radius-sm)] bg-surface" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="skeleton-sweep h-48 rounded-[var(--radius)] border border-line bg-surface"
          />
        ))}
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
