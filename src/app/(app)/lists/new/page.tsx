import { redirect } from "next/navigation";

/**
 * Creating a list is a dialog on the lists page now. This route stays so that
 * existing links and bookmarks still work: it lands on the lists with the
 * dialog already open.
 */
export default function NewListPage(): never {
  redirect("/lists?new");
}
