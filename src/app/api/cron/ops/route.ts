import { checkAndAlert } from "@/server/ops/alerts";
import { cronRoute, pruneOpsHistory } from "@/server/ops/jobs";

/** Health checks → alerts to super admins; prunes old job runs and error events. Every 5 minutes. */
export const { GET, POST } = cronRoute("ops", async () => ({ ...(await checkAndAlert()), pruned: await pruneOpsHistory() }));
