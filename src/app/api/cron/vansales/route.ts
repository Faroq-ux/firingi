import { processVanSales } from "@/server/vansales/service";
import { cronRoute } from "@/server/ops/jobs";

/** Cash collected on vans is netted from supplier payouts; vans still out too long are flagged. Hourly, "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("vansales", () => processVanSales());
