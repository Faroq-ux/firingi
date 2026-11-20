import { runGroupsJob } from "@/server/buying-groups/service";
import { cronRoute } from "@/server/ops/jobs";

/** Buying groups (Phase 49): place each member's order of group order rounds that have closed. Every 15 minutes. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("groups", async () => runGroupsJob());
