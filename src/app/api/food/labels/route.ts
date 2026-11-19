import { getLocale } from "next-intl/server";
import { getContext } from "@/server/context";
import { foodSettings, myFoodProducts } from "@/server/food/service";
import { foodLabelsFor } from "@/components/food/labels";
import { AppError } from "@/server/errors";

/** Shelf labels (PDF) with a QR code to the public product page, for the products the customer buys. Phase 44. */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const s = await foodSettings();
    if (!s.enabled || !s.publicPage) return new Response("Switched off", { status: 404 });
    const { l, locale } = await foodLabelsFor(new URL(req.url).searchParams.get("lang") ?? (await getLocale()));
    const only = new URL(req.url).searchParams.getAll("p");
    const items = (await myFoodProducts(ctx, locale)).filter((x) => !only.length || only.includes(x.productId));
    const base = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? new URL(req.url).origin).replace(/\/$/, "");
    const { renderShelfLabels } = await import("@/server/pdf/food");
    const pdf = await renderShelfLabels({ locale, baseUrl: base, items, l });
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="shelf-labels.pdf"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
