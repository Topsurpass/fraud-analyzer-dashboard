import { Suspense } from "react";
import { ListsView } from "@/components/lists/ListsView";

/**
 * `ListsView` reads the query string (the old /lists/new link arrives as
 * `?new`), which needs a Suspense boundary Next can name rather than infer.
 */
export default function ListsPage() {
  return (
    <Suspense fallback={null}>
      <ListsView />
    </Suspense>
  );
}
