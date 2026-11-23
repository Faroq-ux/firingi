import { processAssortments } from "@/server/assortments/service";
import { cronRoute } from "@/server/ops/jobs";

/** Customers with must-stock products not ordered lately are reminded (at most weekly). Hourly, "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("assortments", () => processAssortments());
