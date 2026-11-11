import { runExpiryAlerts } from "@/server/inventory/expiry";
import { cronRoute } from "@/server/ops/jobs";

/** Daily expiry alerts for suppliers that have them (Phase 24). "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("inventory", () => runExpiryAlerts());
