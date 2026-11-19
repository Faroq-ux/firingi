import { processEInvoiceQueue } from "@/server/einvoice/service";
import { cronRoute } from "@/server/ops/jobs";

/** E-invoicing (Phase 46): send queued e-invoices (retries with back-off), follow their status, read the services' inboxes. Every 10 minutes. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("einvoice", async () => processEInvoiceQueue(100));
