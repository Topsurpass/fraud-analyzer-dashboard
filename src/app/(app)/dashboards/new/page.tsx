"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboards } from "@/services/dashboards";
import { ApiError } from "@/services/api-client";
import { PageBody } from "@/components/PageBody";
import { Button, Field, Input, Panel } from "@/components/ui";

export default function NewDashboardPage() {
  const router = useRouter();
  const { create } = useDashboards();
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <PageBody crumbs={[{ label: "Dashboards" }, { label: "New" }]}>
      <Panel title="New dashboard" className="max-w-md">
        <form
          className="space-y-3 p-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setTouched(true);
            if (!name.trim() || busy) return;
            setBusy(true);
            setError(null);
            try {
              const dashboard = await create(name);
              router.push(`/dashboards/${dashboard.id}`);
            } catch (cause) {
              setError(
                cause instanceof ApiError
                  ? cause.displayMessage
                  : "Could not create the dashboard",
              );
              setBusy(false);
            }
          }}
        >
          <Field
            label="Name"
            htmlFor="dash-name"
            error={touched && !name.trim() ? "A name is required." : null}
            hint="Dashboards group saved queries across connections."
          >
            <Input
              id="dash-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Card testing"
              autoFocus
            />
          </Field>

          <p className="text-[11px] text-muted">
            Dashboards live on the engine, so the same boards appear on every machine.
          </p>

          {error ? (
            <p className="border border-change/40 bg-change/5 px-2.5 py-1.5 text-[11px] text-change">
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button type="submit" tone="primary" disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </Button>
            <Button type="button" onClick={() => router.push("/")}>
              Cancel
            </Button>
          </div>
        </form>
      </Panel>
    </PageBody>
  );
}
