import { expireQuotes } from "@/server/buying/quotes";
import { runRecurringOrders } from "@/server/buying/recurring";
import { runRecurringExpenses } from "@/server/accounting/entries";
import { cronRoute } from "@/server/ops/jobs";

/** Recurring orders (reminders + due orders), quote expiry (Phase 26) and fixed monthly expenses (Phase 27). "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("buying", async () => ({ ...(await runRecurringOrders()), expiredQuotes: await expireQuotes(), recurringExpenses: (await runRecurringExpenses()).added }));
