import { runBankJob } from "@/server/bank/job";
import { cronRoute } from "@/server/ops/jobs";

/** Bank reconciliation (Phase 37): fetch the bank feeds, match what came in, warn about consents ending. Daily. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("bank", async () => runBankJob());
