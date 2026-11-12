import { runComplianceJob } from "@/server/compliance/service";
import { cronRoute } from "@/server/ops/jobs";

/** Supplier certificates (Phase 28): expiry, 30/14/7-day reminders, re-check alerts, automatic pauses. Daily. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("compliance", async () => runComplianceJob());
