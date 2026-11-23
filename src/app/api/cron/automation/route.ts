import { cronRoute } from "@/server/ops/jobs";

/** AI Centre automations (events, schedules, waits), expired approvals, scheduled agents, budget alert. Every 5 minutes, "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("automation", async () => (await import("@/server/ai/ops/workflows")).automationJob());
