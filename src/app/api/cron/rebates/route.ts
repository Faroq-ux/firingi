import { runRebatesJob } from "@/server/rebates/service";
import { cronRoute } from "@/server/ops/jobs";

/** Rebates & bonuses (Phase 48): settle ended periods (credit notes, free goods), end finished deals, "you're close" reminders. Daily. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("rebates", async () => runRebatesJob());
