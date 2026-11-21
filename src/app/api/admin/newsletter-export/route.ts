/** Back office: confirmed newsletter subscribers as CSV (Phase 56). */
import { getContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { exportSubscribers } from "@/server/landing/service";

export async function GET() {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const csv = await exportSubscribers(ctx);
    return new Response(`﻿${csv}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="firingi-newsletter-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
