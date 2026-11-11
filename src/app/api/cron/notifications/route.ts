import { processOutbox } from "@/server/notify/dispatch";
import { processScheduledCampaigns } from "@/server/marketing/campaigns";
import { cronRoute } from "@/server/ops/jobs";

/** Sends scheduled marketing campaigns and retries failed messages. Every 2 minutes, "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("notifications", async () => {
  const campaigns = await processScheduledCampaigns();
  return { ...(await processOutbox(200)), ...campaigns };
});
