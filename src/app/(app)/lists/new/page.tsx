"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ItemListWrite } from "@/contracts/api";
import { createList } from "@/services/api-client";
import { useLists } from "@/lib/ListsContext";
import { PageBody } from "@/components/PageBody";
import { Panel } from "@/components/ui";
import { ListForm } from "@/components/lists/ListForm";
import { listErrorMessage, stashCreatedReport } from "@/components/lists/items";

const EMPTY = { name: "", description: "", itemsText: "" };

export default function NewListPage() {
  const router = useRouter();
  const { reload } = useLists();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (body: ItemListWrite) => {
    setBusy(true);
    setError(null);
    try {
      const saved = await createList(body);
      reload();
      // The next page says how many pasted items were dropped; a silent
      // redirect hides that a 500-line paste lost 40.
      stashCreatedReport(saved.id, { received: saved.received, kept: saved.kept });
      router.push(`/lists/${saved.id}`);
    } catch (cause) {
      setError(listErrorMessage(cause, "Could not create the list"));
      setBusy(false);
    }
  };

  return (
    <PageBody crumbs={[{ label: "Lists", href: "/lists" }, { label: "New" }]}>
      <Panel title="New list" className="max-w-2xl">
        <ListForm
          initial={EMPTY}
          submitLabel="Create"
          busyLabel="Creating…"
          busy={busy}
          autoFocus
          error={error}
          onSubmit={create}
          onCancel={() => router.push("/lists")}
        />
      </Panel>
    </PageBody>
  );
}
