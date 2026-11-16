import { runAdsJob } from "@/server/ads/service";
import { cronRoute } from "@/server/ops/jobs";

/** Advertising (Phase 34): booked days, budgets, low balances, monthly ad invoices, settling against payouts. Hourly. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("ads", async () => runAdsJob());
