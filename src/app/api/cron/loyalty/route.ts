import { runLoyaltyJob } from "@/server/loyalty/service";
import { cronRoute } from "@/server/ops/jobs";

/** Loyalty & rewards (Phase 32): points for delivered orders, reversals, refunds, expiry, reminders, tiers. Hourly. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("loyalty", async () => runLoyaltyJob());
