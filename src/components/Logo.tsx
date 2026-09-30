/**
 * The product mark: a shield with a live signal trace through it. Drawn in
 * SVG so it follows the theme's accent, and sized by the caller.
 */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="logo-fill" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7c7cff" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <path
        d="M16 2.5 5 6.6v8.2c0 6.6 4.5 11.6 11 14.7 6.5-3.1 11-8.1 11-14.7V6.6L16 2.5Z"
        fill="url(#logo-fill)"
      />
      <path
        d="M8.5 16.5h4l2.2-5 3.1 9.2 2.1-4.2h3.6"
        stroke="#fff"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={compact ? 30 : 32} />
      {compact ? null : (
        <span className="leading-none">
          <span className="display block text-[15px] font-semibold tracking-tight text-ink">
            Fraud Analyzer
          </span>
          <span className="mt-1 block text-[11px] text-muted">Risk monitoring</span>
        </span>
      )}
    </span>
  );
}
