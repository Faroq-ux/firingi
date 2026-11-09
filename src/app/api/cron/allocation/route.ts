import { timingSafeEqual } from "node:crypto";
import { processOverdue } from "@/server/allocation/engine";

/** Moves orders suppliers didn't confirm in time. Call every 10–15 minutes with "Authorization: Bearer $CRON_SECRET". */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET is not set", { status: 503 });
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await processOverdue());
}
export const GET = run;
export const POST = run;
