import { runDailyTillPosting } from "@/server/pos/service";
import { cronRoute } from "@/server/ops/jobs";

/** Till sales (Phase 47) into each company's Accounting: daily cash / card / other by VAT rate, the last 7 days rebuilt. Daily 00:20. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("pos-daily", async () => runDailyTillPosting());
