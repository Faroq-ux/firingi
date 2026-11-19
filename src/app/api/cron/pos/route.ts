import { processPosFiscalQueue } from "@/server/pos/fiscal";
import { cronRoute } from "@/server/ops/jobs";

/** Till receipts (Phase 47): send waiting receipts to the businesses' certified providers, with back-off. Every 5 minutes. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("pos", async () => processPosFiscalQueue(200));
