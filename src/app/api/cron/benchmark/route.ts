import { cronRoute } from "@/server/ops/jobs";

/** Price benchmark: rebuild when older than FIRINGI's hours; monthly "you could save" message. Hourly, "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("benchmark", async () => (await import("@/server/benchmark/job")).processBenchmark());
