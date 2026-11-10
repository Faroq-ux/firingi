import { timingSafeEqual } from "node:crypto";
import { processOutbox } from "@/server/notify/dispatch";
import { processScheduledCampaigns } from "@/server/marketing/campaigns";

/** Sends scheduled marketing campaigns and retries failed messages. Call every few minutes with "Authorization: Bearer $CRON_SECRET". */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET is not set", { status: 503 });
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return new Response("Unauthorized", { status: 401 });
  const campaigns = await processScheduledCampaigns();
  return Response.json({ ...(await processOutbox(200)), ...campaigns });
}
export const GET = run;
export const POST = run;
