import { processConsignment } from "@/server/consignment/service";
import { cronRoute } from "@/server/ops/jobs";

/** Unanswered counts confirmed and billed, "count due" reminders, "expires soon" alerts. Hourly, "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("consignment", () => processConsignment());
