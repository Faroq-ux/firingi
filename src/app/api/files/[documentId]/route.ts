import { getContext } from "@/server/context";
import { readDocumentFile } from "@/server/services/documents";
import { AppError } from "@/server/errors";

/** Permission-checked document download. Files are never publicly reachable. */
export async function GET(_req: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const { data, mimeType, fileName } = await readDocumentFile(ctx, (await params).documentId);
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": mimeType,
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
