/** Shelf price labels PDF for the shop (POST: ids, size, fields, copies). */
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { getContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { assertFormat, printLabels } from "@/server/labels/service";
import { DEFAULT_FIELDS } from "@/lib/shelf-labels";

const Body = z.object({
  ids: z.array(z.string().min(1).max(40)).min(1).max(500), format: z.string().max(20), copies: z.number().int().min(1).max(50).default(1),
  custom: z.object({ paper: z.enum(["A4", "ROLL"]), w: z.number(), h: z.number(), top: z.number(), left: z.number(), gapX: z.number(), gapY: z.number() }).partial().optional(),
  test: z.boolean().optional(),
  fields: z.object({ brand: z.boolean(), origin: z.boolean(), code: z.enum(["BARCODE", "QR", "NONE"]), unitPrice: z.boolean(), shopName: z.boolean(), date: z.boolean() }).default(DEFAULT_FIELDS),
});

export async function POST(req: Request) {
  const ctx = await getContext().catch(() => null);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const b = parsed.data;
  try {
    const pdf = await printLabels(ctx, b.ids, assertFormat(b.format), b.fields, await getLocale(), b.copies, { custom: b.custom, test: b.test });
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="shelf-labels-${b.test ? "test-" : ""}${b.format}.pdf"`, "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
