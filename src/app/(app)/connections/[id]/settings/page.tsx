"use client";

import { use, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { ConnectionTestResult } from "@/contracts/api";
import {
  ApiError,
  deleteConnection,
  getConnection,
  testConnection,
  updateConnection,
} from "@/services/api-client";
import { useConnections } from "@/services/connections/ConnectionsContext";
import { useResource } from "@/lib/useResource";
import { PageBody } from "@/components/PageBody";
import { ConnectionForm, type ConnectionFormValues } from "@/components/ConnectionForm";
import { TestOutcome } from "@/components/TestOutcome";
import { Button, ErrorState, Panel } from "@/components/ui";
import { SchemaBrowser } from "@/components/SchemaBrowser";
import { formatDateTime } from "@/services/format";

/** Edit credentials, re-test, browse the schema, or delete the connection. */
export default function ConnectionSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { reload } = useConnections();

  const load = useCallback((signal: AbortSignal) => getConnection(id, { signal }), [id]);
  const connection = useResource(load);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [test, setTest] = useState<ConnectionTestResult | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const name = connection.data?.name ?? "Connection";

  const save = async (values: ConnectionFormValues) => {
    setBusy(true);
    setError(null);
    setTest(null);
    try {
      const result = await updateConnection(id, {
        name: values.name,
        host: values.host,
        port: values.port,
        database: values.database,
        username: values.username,
        sqlite_path: values.sqlite_path,
        // An empty box means "leave the stored password alone", not "clear it".
        ...(values.password ? { password: values.password } : {}),
      });
      connection.reload();
      reload();
      setTest({
        connection_id: id,
        status: result.connection.status,
        tested_at: result.connection.last_tested_at ?? new Date().toISOString(),
        ok: result.test_ok,
        error: result.test_error,
        error_code: result.test_error_code,
      });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : null);
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    setError(null);
    try {
      setTest(await testConnection(id));
      connection.reload();
      reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : null);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteConnection(id);
      reload();
      router.push("/");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : null);
      setBusy(false);
    }
  };

  return (
    <PageBody
      crumbs={[
        { label: "Connections", href: "/" },
        { label: name, href: `/connections/${id}` },
        { label: "Settings" },
      ]}
    >
      {connection.error ? (
        <ErrorState
          title="Could not load this connection"
          message={connection.error.displayMessage}
          onRetry={connection.reload}
        />
      ) : (
        <div className="grid max-w-5xl gap-3 lg:grid-cols-2">
          <Panel
            title="Credentials"
            actions={
              <Button onClick={runTest} disabled={busy}>
                {busy ? "Testing…" : "Test now"}
              </Button>
            }
          >
            <div className="p-3">
              {connection.initial ? (
                <div className="skeleton-sweep space-y-3">
                  {[0, 1, 2, 3].map((index) => (
                    <div key={index} className="h-8 bg-line" />
                  ))}
                </div>
              ) : (
                <ConnectionForm
                  initial={connection.data}
                  submitLabel="Save and test"
                  busy={busy}
                  onSubmit={save}
                  passwordHint="Leave blank to keep the stored password."
                />
              )}

              {error ? (
                <p className="mt-3 border border-change/40 bg-change/5 px-3 py-2 text-[12px] text-change">
                  {error.displayMessage}
                </p>
              ) : null}

              {test ? (
                <div className="mt-3">
                  <TestOutcome
                    ok={test.ok}
                    error={test.error}
                    errorCode={test.error_code}
                    testedAt={formatDateTime(test.tested_at)}
                  />
                </div>
              ) : connection.data?.status === "failed" && connection.data.last_test_error ? (
                <div className="mt-3">
                  <TestOutcome
                    ok={false}
                    error={connection.data.last_test_error}
                    testedAt={formatDateTime(connection.data.last_tested_at)}
                  />
                </div>
              ) : null}
            </div>
          </Panel>

          <div className="space-y-3">
            <SchemaBrowser connectionId={id} />

            <Panel title="Danger zone">
              <div className="p-3">
                <p className="text-[12px] text-muted">
                  Deleting a connection removes its saved queries and their execution history
                  from the engine. Dashboards that referenced them will drop the missing cards.
                </p>
                {confirmingDelete ? (
                  <div className="mt-3 flex items-center gap-2">
                    <Button tone="danger" onClick={remove} disabled={busy}>
                      Delete {name} permanently
                    </Button>
                    <Button onClick={() => setConfirmingDelete(false)} disabled={busy}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    tone="danger"
                    className="mt-3"
                    onClick={() => setConfirmingDelete(true)}
                    disabled={busy}
                  >
                    Delete connection
                  </Button>
                )}
              </div>
            </Panel>
          </div>
        </div>
      )}
    </PageBody>
  );
}
