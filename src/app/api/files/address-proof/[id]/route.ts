import { getContext } from "@/server/context";
import { readAddressProof } from "@/server/services/addresses";
import { AppError } from "@/server/errors";

/** The till invoice sent with an address request: the company itself and FIRINGI staff only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const { data, mimeType, fileName } = await readAddressProof(ctx, (await params).id);
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
