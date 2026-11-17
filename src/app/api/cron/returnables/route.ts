import { runReturnablesJob } from "@/server/returnables/service";
import { cronRoute } from "@/server/ops/jobs";

/** Returnables (Phase 40): empties held too long — reminders, or the deposit kept as the price (admin rule). Daily. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("returnables", async () => runReturnablesJob());
