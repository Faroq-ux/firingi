import { cronRoute } from "@/server/ops/jobs";

/** Food safety logbook: missed temperature checks (once a day per business), training running out. Hourly, "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("haccp", async () => (await import("@/server/haccp/job")).processHaccp());
