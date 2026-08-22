"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboards } from "@/services/dashboards";
import { PageBody } from "@/components/PageBody";
import { Button, Field, Input, Panel } from "@/components/ui";

export default function NewDashboardPage() {
  const router = useRouter();
  const { create } = useDashboards();
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);

  return (
    <PageBody crumbs={[{ label: "Dashboards" }, { label: "New" }]}>
      <Panel title="New dashboard" className="max-w-md">
        <form
          className="space-y-3 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (!name.trim()) return;
            const dashboard = create(name);
            router.push(`/dashboards/${dashboard.id}`);
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
            The engine has no dashboard resource, so this grouping is stored in this browser
            only. The queries themselves, and everything they return, stay on the engine.
          </p>

          <div className="flex items-center gap-2">
            <Button type="submit" tone="primary">
              Create
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
