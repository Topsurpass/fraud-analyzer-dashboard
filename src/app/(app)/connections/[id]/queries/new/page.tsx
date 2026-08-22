"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createQuery } from "@/services/api-client";
import { useConnections } from "@/services/connections/ConnectionsContext";
import { PageBody } from "@/components/PageBody";
import { QueryEditor, type QueryEditorValues } from "@/components/QueryEditor";

export default function NewQueryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { connections } = useConnections();
  const name = connections.find((entry) => entry.id === id)?.name ?? "Connection";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (values: QueryEditorValues) => {
    setBusy(true);
    setError(null);
    try {
      await createQuery(id, values);
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
        busy={busy}
        error={error}
        onSubmit={submit}
        onCancel={() => router.push(`/connections/${id}`)}
      />
    </PageBody>
  );
}
