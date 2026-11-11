import { getContext } from "@/server/context";
import { duePayoutsCsv } from "@/server/services/payouts";
import { AppError } from "@/server/errors";

/** CSV of supplier payouts due (overdue + within the window), for the bank or the accountant. */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const within = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get("within")) || 7));
    const csv = await duePayoutsCsv(ctx, within);
    return new Response(`﻿${csv}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="firingi-payouts-due-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
