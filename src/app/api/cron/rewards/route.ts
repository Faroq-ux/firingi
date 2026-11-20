import { runRewardsJob } from "@/server/rewards/service";
import { cronRoute } from "@/server/ops/jobs";

/** Rewards shop (Phase 55): vouchers used / expired, supplier products delivered / expired, points back, reminders, low stock. Daily. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("rewards", async () => runRewardsJob());
