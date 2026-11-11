import { processFiscalQueue } from "@/server/invoicing/fiscal";
import { remindDuePayouts } from "@/server/services/payouts";
import { cronRoute } from "@/server/ops/jobs";

/** Sends booked invoices / credit notes to Moloni (with retries) and reminds finance of supplier payouts due. Every 5 minutes. */
export const { GET, POST } = cronRoute("invoicing", async () => ({ fiscal: await processFiscalQueue(50), payouts: await remindDuePayouts() }));
