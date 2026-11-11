import { refreshRecommendations } from "@/server/ai/feed";
import { cronRoute } from "@/server/ops/jobs";

/** Recomputes the AI suggestions (forecasts, stock, reorders, risks). Hourly, "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("ai", () => refreshRecommendations());
