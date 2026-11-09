import { getContext } from "@/server/context";
import { statementPdfData } from "@/server/data/finance-docs";
import { renderStatementPdf } from "@/server/pdf/documents";
import { AppError } from "@/server/errors";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const data = await statementPdfData(ctx, (await params).id);
    const pdf = await renderStatementPdf(data);
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${data.number}.pdf"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
