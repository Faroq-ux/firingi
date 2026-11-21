import { runWhatsAppJob } from "@/server/whatsapp/ordering";
import { cronRoute } from "@/server/ops/jobs";

/** WhatsApp ordering (Phase 58): messages left over, expired proposals, reorder reminders. Every 5 minutes. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("whatsapp", async () => runWhatsAppJob());
