import { cronRoute } from "@/server/ops/jobs";

/** Pre-orders & price locks: close and share out, place orders before delivery, reminders. Hourly, "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("preorders", async () => (await import("@/server/preorders/job")).processPreorders());
