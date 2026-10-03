import type { QueryChart } from "@/contracts/api";
import { publishStatusOf, rejectionNote } from "@/services/publishing/state";

/**
 * The mark that says a chart is visible to the whole team.
 *
 * Deliberately quiet. Most charts are private, so the badge is the exception
 * rather than the rule, and a loud treatment on the exception makes a board of
 * mostly-private cards look alarming. It is also deliberately NOT in either
 * signal colour: `--signal-alert` means a flag rule matched a row and
 * `--signal-change` means a measure moved past its threshold. "Other people can
 * see this" is neither of those, and borrowing one of them would blunt both.
 *
 * The tooltip carries the consequence rather than restating the state, because
 * the state is already obvious from the word and the consequence is not: a
 * published chart's query is frozen.
 */
export function PublishedBadge({
  chart,
  className,
  sharedBy,
}: {
  chart: Pick<QueryChart, "is_public"> &
    Partial<Pick<QueryChart, "publish_status" | "publish_rejection">>;
  className?: string;
  /**
   * Set on a card the viewer did not add: somebody published it and it sits on
   * their board among their own. It says who, because a card that appears on
   * its own needs to explain itself, and this is what the separate "Published by
   * the team" heading used to do before shared cards were ranked with the rest.
   */
  sharedBy?: string | null;
}) {
  const status = publishStatusOf(chart);

  if (status === "pending") {
    return (
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded-[3px] border border-dashed border-line-strong px-1 py-px text-[11.5px] font-medium leading-tight text-muted ${className ?? ""}`}
        title="Waiting for an administrator to approve it. Nobody else can see this chart yet, and its query is frozen while it waits."
      >
        <span aria-hidden="true" className="h-1 w-1 rounded-full border border-current" />
        Awaiting approval
        <span className="sr-only">
          . An administrator has to approve it before anyone else can see it, and its query
          is frozen while it waits.
        </span>
      </span>
    );
  }

  if (status === "private" && chart.publish_rejection) {
    return (
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded-[3px] border border-line-strong px-1 py-px text-[11.5px] font-medium leading-tight text-muted ${className ?? ""}`}
        title={`Not published: ${chart.publish_rejection.rejected_by_name} declined the request.`}
      >
        <span aria-hidden="true" className="h-1 w-1 bg-current" />
        Not approved
      </span>
    );
  }

  if (status !== "published") return null;

  const shared = sharedBy !== undefined;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-[3px] border border-line-strong px-1 py-px text-[11.5px] font-medium leading-tight text-muted ${className ?? ""}`}
      title={
        shared
          ? `${sharedBy ?? "A colleague"} published this for the whole team, so it is on your board. You cannot remove it from here; pin it to keep it at the top.`
          : "Everyone signed in can see this chart. Its query is frozen while it is published."
      }
    >
      {/*
       * A filled dot rather than an icon font or an SVG: it reads at 10px,
       * costs nothing, and cannot fail to load.
       */}
      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-current" />
      {shared ? `Shared by ${sharedBy ?? "a colleague"}` : "Published"}
      <span className="sr-only">
        {shared
          ? ". Published for the whole team by its author; it is on your board because it is shared."
          : ". Visible to everyone signed in, and its query is frozen while published."}
      </span>
    </span>
  );
}

/**
 * Why a request was declined, on the card, for its author.
 *
 * A badge says that something happened; this says what the administrator wrote,
 * which is the only thing that tells the author what to change before asking
 * again. Renders nothing unless the chart carries a rejection, so it costs a
 * card nothing in the ordinary case.
 */
export function PublishRejectionNote({
  chart,
}: {
  chart: Partial<Pick<QueryChart, "publish_status" | "publish_rejection">> &
    Pick<QueryChart, "is_public">;
}) {
  if (publishStatusOf(chart) !== "private") return null;
  const note = rejectionNote(chart.publish_rejection);
  if (!note) return null;

  return (
    <p
      role="status"
      className="mx-5 mb-1 rounded-[var(--radius-sm)] border border-line bg-sunken px-2.5 py-1.5 text-[12px] leading-snug text-secondary"
    >
      <span className="font-medium text-ink">{note.headline}</span>
      {note.reason ? <> {note.reason}</> : null}
      <span className="text-muted"> Use the card menu to ask again.</span>
    </p>
  );
}
