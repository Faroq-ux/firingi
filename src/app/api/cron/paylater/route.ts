import { runPayLaterJob } from "@/server/pay-later/service";
import { cronRoute } from "@/server/ops/jobs";

/** Pay later (Phase 50): the partner pays invoiced plans; own-credit instalments tracked, reminded, flagged overdue. Every 15 minutes. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("paylater", async () => runPayLaterJob());
