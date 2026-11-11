import { processFeeds } from "@/server/integrations/feeds";
import { processWebhooks, pruneIntegrationLogs } from "@/server/integrations/webhooks";
import { cronRoute } from "@/server/ops/jobs";

/** Supplier integrations: scheduled price / stock feeds that are due, webhook deliveries (incl. retries), old logs pruned. Every 5 minutes. */
export const { GET, POST } = cronRoute("integrations", async () => ({ feeds: await processFeeds(), webhooks: await processWebhooks(), pruned: await pruneIntegrationLogs() }));
