import { getLocale } from "next-intl/server";
import { getContext } from "@/server/context";
import { supplierReportFile } from "@/server/trade/service";
import { AppError } from "@/server/errors";

/** A supplier's own EU report (?period=2026-11&kind=ECSL|DISPATCHES&format=csv|xlsx). Phase 57. */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const u = new URL(req.url).searchParams;
  try {
    const out = await supplierReportFile(ctx, u.get("period") ?? "", u.get("kind") === "DISPATCHES" ? "DISPATCHES" : "ECSL", u.get("format") === "xlsx" ? "xlsx" : "csv", await getLocale());
    return new Response(typeof out.body === "string" ? out.body : new Uint8Array(out.body), { headers: { "content-type": out.contentType, "content-disposition": `attachment; filename="${out.fileName}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
