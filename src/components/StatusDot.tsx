import type { ConnectionStatus } from "@/contracts/api";

/**
 * Connection status in the rail.
 *
 * Filled means the engine has tested the connection and it answered; hollow
 * means it has not, or it failed. The two hollow states are told apart by shape
 * - a plain ring versus a struck-through ring - and never by colour: the design
 * brief reserves --signal-alert for anomalous data points and forbids it on UI
 * chrome, and a colour-only distinction would be invisible to a colour-blind
 * analyst anyway.
 */
const LABELS: Record<ConnectionStatus, string> = {
  ok: "Connected",
  untested: "Not yet tested",
  failed: "Connection failed",
};

export function StatusDot({
  status,
  className,
}: {
  status: ConnectionStatus;
  className?: string;
}) {
  const stroke = status === "ok" ? "var(--signal-live)" : "var(--text-muted)";

  return (
    <svg
      viewBox="0 0 10 10"
      width={9}
      height={9}
      className={`shrink-0 ${className ?? ""}`}
      role="img"
      aria-label={LABELS[status]}
    >
      <title>{LABELS[status]}</title>
      <circle
        cx={5}
        cy={5}
        r={3.25}
        fill={status === "ok" ? stroke : "none"}
        stroke={stroke}
        strokeWidth={1.25}
      />
      {status === "failed" ? (
        <line x1={2.2} y1={7.8} x2={7.8} y2={2.2} stroke={stroke} strokeWidth={1.25} />
      ) : null}
    </svg>
  );
}
