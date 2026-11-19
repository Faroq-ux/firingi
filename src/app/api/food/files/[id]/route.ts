import { getContext } from "@/server/context";
import { foodFile } from "@/server/food/service";
import { AppError } from "@/server/errors";

/** A food file (?kind=label|spec|cert&cert=ID) — the label photo, spec sheet or a diet certificate. Phase 44. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const u = new URL(req.url);
  const kind = (["label", "spec", "cert"].includes(u.searchParams.get("kind") ?? "") ? u.searchParams.get("kind") : "label") as "label" | "spec" | "cert";
  try {
    const f = await foodFile(ctx, (await params).id, kind, u.searchParams.get("cert") ?? undefined);
    const safe = f.name.replace(/[^\w.\- ]+/g, "_");
    return new Response(new Uint8Array(f.buf), { headers: { "content-type": f.mime, "content-disposition": `inline; filename="${safe}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
