import { getContext } from "@/server/context";
import { vendorInvoiceFile } from "@/server/data/finance-docs";
import { readStored } from "@/server/services/storage";
import { AppError } from "@/server/errors";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const vi = await vendorInvoiceFile(ctx, (await params).id);
    const data = await readStored(vi.fileKey);
    const type = vi.fileKey.endsWith(".pdf") ? "application/pdf" : vi.fileKey.endsWith(".png") ? "image/png" : "image/jpeg";
    return new Response(new Uint8Array(data), { headers: { "content-type": type, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
