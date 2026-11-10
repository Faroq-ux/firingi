import { timingSafeEqual } from "node:crypto";
import { refreshRecommendations } from "@/server/ai/feed";

/** Recomputes the AI suggestions (forecasts, stock, reorders, risks). Call hourly with "Authorization: Bearer $CRON_SECRET". */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET is not set", { status: 503 });
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await refreshRecommendations());
}
export const GET = run;
export const POST = run;
