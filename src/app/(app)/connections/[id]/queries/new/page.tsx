"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  createQuery,
  putFlagRules,
  putQueryCharts,
} from "@/services/api-client";
import { useConnections } from "@/services/connections/ConnectionsContext";
import { PageBody } from "@/components/PageBody";
import { QueryEditor, type QueryEditorValues } from "@/components/QueryEditor";

export default function NewQueryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { connections } = useConnections();
  const name = connections.find((entry) => entry.id === id)?.name ?? "Connection";

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (values: QueryEditorValues) => {
    setBusy(true);
    setError(null);
    try {
      const { flag_rules: rules, charts, ...query } = values;
      const created = await createQuery(id, query);
      // Two calls because rules hang off a query id that does not exist until
      // the POST returns. Saving them second means a rule failure cannot lose
      // the query the analyst just wrote.
      if (rules.length > 0) await putFlagRules(created.id, { rules });
      // Creating a query seeds one table chart, so this is only sent when the
      // analyst configured something else - and it replaces that seed.
      if (charts.length > 0) await putQueryCharts(created.id, charts);

      // Saved. `busy` stays true through the navigation so the form cannot be
      // submitted twice, but the label changes: leaving it on "Saving…" while
      // the next page resolves is what made a successful save look like a
      // hang. The segment's loading.tsx now covers the navigation itself.
      setSaved(true);
      router.push(`/connections/${id}`);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause
          : new ApiError({ kind: "network", message: "Could not save the query", url: "" }),
      );
      setBusy(false);
    }
  };

  return (
    <PageBody
      crumbs={[
        { label: "Connections", href: "/" },
        { label: name, href: `/connections/${id}` },
        { label: "New query" },
      ]}
    >
      <QueryEditor
        connectionId={id}
        submitLabel="Save query"
        busyLabel={saved ? "Saved · opening…" : "Saving…"}
        busy={busy}
        error={error}
        onSubmit={submit}
        onCancel={() => router.push(`/connections/${id}`)}
      />
    </PageBody>
  );
}
