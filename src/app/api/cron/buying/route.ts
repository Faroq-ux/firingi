import { expireQuotes } from "@/server/buying/quotes";
import { runRecurringOrders } from "@/server/buying/recurring";
import { cronRoute } from "@/server/ops/jobs";

/** Recurring orders (reminders + due orders) and quote expiry (Phase 26). "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("buying", async () => ({ ...(await runRecurringOrders()), expiredQuotes: await expireQuotes() }));
