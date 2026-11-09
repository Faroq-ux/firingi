import { getContext } from "@/server/context";
import { catalogueItem } from "@/server/data/catalogue-buyer";
import { AppError } from "@/server/errors";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await catalogueItem(ctx, (await params).id));
  } catch (e) {
    const err = e instanceof AppError ? e : null;
    return Response.json({ error: err?.message ?? "Error" }, { status: err?.status ?? 500 });
  }
}
