import { runReviewJob } from "@/server/reviews/service";
import { cronRoute } from "@/server/ops/jobs";

/** Product reviews (Phase 53): "How was …?" reminders a few days after delivery, once per product. Daily. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("reviews", async () => runReviewJob());
