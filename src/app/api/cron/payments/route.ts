import { processPayments } from "@/server/payments/jobs";
import { cronRoute } from "@/server/ops/jobs";

/** Online payments: expiry, provider polling, direct debit notices + collections, reminders, unpaid orders, credit. Every 5 minutes. */
export const { GET, POST } = cronRoute("payments", () => processPayments());
