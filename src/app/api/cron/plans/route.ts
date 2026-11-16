import { runPlansJob } from "@/server/plans/service";
import { cronRoute } from "@/server/ops/jobs";

/** Supplier plans (Phase 36): trial reminders and endings, monthly plan invoices, plan changes at period end, settling against payouts. Daily. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("plans", async () => runPlansJob());
