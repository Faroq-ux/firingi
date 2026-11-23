import { weeklyReportJob } from "@/server/ai/centre/reports";
import { cronRoute } from "@/server/ops/jobs";

/** The weekly executive AI report to FIRINGI's admins (Monday from 07:00 Lisbon, once). Hourly, "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("ai-reports", () => weeklyReportJob());
