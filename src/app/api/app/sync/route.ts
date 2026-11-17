/** Phase 39: carry out actions done on a phone without signal, in the order they were done (each one only once). */
import { getContext } from "@/server/context";
import { syncOp, type SyncInput } from "@/server/app/service";
import { AppError } from "@/server/errors";

const NO_STORE = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" };

export async function POST(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: NO_STORE });
  let body: { ops?: SyncInput[] };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "Bad request" }), { status: 400, headers: NO_STORE }); }
  const ops = Array.isArray(body.ops) ? body.ops.slice(0, 25) : [];
  const results = [];
  for (const op of ops) {
    try {
      results.push({ clientId: op.clientId, ...(await syncOp(ctx, op)) });
    } catch (e) {
      results.push({ clientId: op?.clientId, status: "FAILED", error: e instanceof AppError ? e.message : "Something went wrong. Try again later." });
      if (!(e instanceof AppError)) console.error("app sync", e);
    }
  }
  return new Response(JSON.stringify({ results }), { headers: NO_STORE });
}
