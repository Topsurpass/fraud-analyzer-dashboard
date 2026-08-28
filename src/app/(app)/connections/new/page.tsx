"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ConnectionCreateResult } from "@/contracts/api";
import { ApiError, createConnection } from "@/services/api-client";
import { useConnections } from "@/services/connections/ConnectionsContext";
import { PageBody } from "@/components/PageBody";
import { RequireCapability } from "@/components/auth/RequireCapability";
import { ConnectionForm, type ConnectionFormValues } from "@/components/ConnectionForm";
import { Panel } from "@/components/ui";
import { TestOutcome } from "@/components/TestOutcome";

/**
 * Creating a connection also tests it. A connection that saved but cannot
 * answer is worse than no connection at all, so the test result is shown here
 * and the analyst decides whether to move on or go back and fix it.
 */
const CRUMBS = [{ label: "Connections", href: "/" }, { label: "New" }];

export default function NewConnectionPage() {
  return (
    <RequireCapability capability="connections.create" crumbs={CRUMBS}>
      <NewConnectionScreen />
    </RequireCapability>
  );
}

function NewConnectionScreen() {
  const router = useRouter();
  const { reload } = useConnections();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConnectionCreateResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (values: ConnectionFormValues) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const created = await createConnection({
        ...values,
        password: values.password ? values.password : null,
      });
      setResult(created);
      reload();
      if (created.test_ok) router.push(`/connections/${created.connection.id}`);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause
          : new ApiError({ kind: "network", message: "Could not create the connection", url: "" }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageBody crumbs={CRUMBS}>
      <Panel title="New connection" className="max-w-2xl">
        <div className="p-3">
          <ConnectionForm
            submitLabel="Create and test"
            busy={busy}
            onSubmit={submit}
            onCancel={() => router.push("/")}
          />

          {error ? (
            <p className="mt-3 border border-change/40 bg-change/5 px-3 py-2 text-[12px] text-change">
              {error.displayMessage}
            </p>
          ) : null}

          {result && !result.test_ok ? (
            <div className="mt-3">
              <TestOutcome
                ok={false}
                error={result.test_error}
                errorCode={result.test_error_code}
                onOpen={() => router.push(`/connections/${result.connection.id}`)}
              />
            </div>
          ) : null}
        </div>
      </Panel>
    </PageBody>
  );
}
