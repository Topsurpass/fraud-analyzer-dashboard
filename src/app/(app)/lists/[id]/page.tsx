import { redirect } from "next/navigation";

/**
 * Editing a list is a dialog on the lists page now. This route stays so that
 * existing links and bookmarks to one list still work: it lands on the lists
 * with that list's dialog already open.
 */
export default async function ListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<never> {
  const { id } = await params;
  redirect(`/lists?open=${encodeURIComponent(id)}`);
}
