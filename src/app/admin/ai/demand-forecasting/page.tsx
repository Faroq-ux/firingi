import { redirect } from "next/navigation";

/** Phase 66: this page moved into the new AI Centre. */
export default function Moved() {
  redirect("/admin/ai/forecasting?tab=DEMAND");
}
