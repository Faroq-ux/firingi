import { runClaimsJob } from "@/server/claims/service";
import { cronRoute } from "@/server/ops/jobs";

/** Quality claims (Phase 31): settle charge-backs, overdue claims, supplier reminders, quality alerts. Daily. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("claims", async () => runClaimsJob());
