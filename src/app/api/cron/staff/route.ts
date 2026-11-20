import { runStaffJob } from "@/server/staff/service";
import { cronRoute } from "@/server/ops/jobs";

/** Staff & time (Phase 52): shift reminders, forgotten clock-outs (remind, then close), no-shows, old records removed. Every 15 minutes. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("staff", async () => runStaffJob());
