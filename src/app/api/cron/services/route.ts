import { cronRoute } from "@/server/ops/jobs";

/** Services & used oil: plan visits ahead, reminders, missed visits, containers full, oil changes, licences, monthly commission invoices. Hourly, "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("services", async () => (await import("@/server/servicing/job")).processServices());
