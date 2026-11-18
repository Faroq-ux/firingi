import { runColdChainJob } from "@/server/coldchain/service";
import { cronRoute } from "@/server/ops/jobs";

/** Cold chain (Phase 42): equipment checks / cleaning / calibration due, loggers out of range. Daily. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("coldchain", async () => runColdChainJob());
