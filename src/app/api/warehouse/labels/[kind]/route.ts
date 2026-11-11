import { getLocale } from "next-intl/server";
import { getContext } from "@/server/context";
import { binLabelsPdf, lotLabelsPdf } from "@/server/warehouse/documents";
import { AppError } from "@/server/errors";

/** Shelf labels (/bins?ids=…) or lot labels (/lots?ids=…) as a PDF — only the company's own. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const kind = (await params).kind;
    const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 400);
    const pdf = kind === "bins" ? await binLabelsPdf(ctx, ids) : kind === "lots" ? await lotLabelsPdf(ctx, ids, await getLocale()) : null;
    if (!pdf) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${kind === "bins" ? "shelf" : "lot"}-labels.pdf"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
