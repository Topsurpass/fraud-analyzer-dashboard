import type { DashboardRead } from "@/contracts/api";

/**
 * Whose board this is, phrased for someone who is not its owner.
 *
 * An administrator's rail lists every board on the instance, and the names
 * people give their boards do not identify them: "Chargebacks" and "Daily" say
 * nothing about who built them, and even the ones that try ("User1 dashboard")
 * only work while there are two accounts. The owner is the identifying fact, so
 * it is rendered rather than left to naming discipline.
 *
 * Returns null when the label would be noise - your own boards, which are most
 * of what an analyst sees, and which do not need to be captioned "you".
 */
export function ownerLabel(
  dashboard: Pick<DashboardRead, "owner_id" | "owner_name" | "owner_email">,
  viewerId: string | null,
): string | null {
  if (dashboard.owner_id !== null && dashboard.owner_id === viewerId) return null;

  /*
   * A board with no owner predates accounts. Saying so is the useful answer:
   * it is the state `fae claim-unowned` exists to fix, and an admin who sees
   * it is the person who can. Silence here would read as "yours".
   */
  if (dashboard.owner_id === null) return "Unowned";

  const name = dashboard.owner_name?.trim();
  if (name) return name;

  /*
   * Falling back to the local part rather than the whole address: the rail is
   * 256px and a full address truncates to something unreadable, while the part
   * before the @ is what distinguishes two people on one instance anyway.
   */
  const email = dashboard.owner_email?.trim();
  if (email) return email.split("@")[0] || email;

  // Owned by an account this response could not resolve. Say that, rather than
  // implying the board is yours by saying nothing.
  return "Another account";
}
