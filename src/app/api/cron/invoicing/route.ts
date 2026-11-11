import { timingSafeEqual } from "node:crypto";
import { processFiscalQueue } from "@/server/invoicing/fiscal";
import { remindDuePayouts } from "@/server/services/payouts";

/**
 * Sends booked invoices / credit notes to Moloni (with retries) and reminds finance of supplier
 * payouts that are due. Call every 5 minutes with "Authorization: Bearer $CRON_SECRET".
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET is not set", { status: 503 });
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return new Response("Unauthorized", { status: 401 });
  return Response.json({ fiscal: await processFiscalQueue(50), payouts: await remindDuePayouts() });
}
export const GET = run;
export const POST = run;
