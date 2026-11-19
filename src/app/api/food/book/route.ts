import { getLocale } from "next-intl/server";
import { getContext } from "@/server/context";
import { foodSettings, myFoodProducts } from "@/server/food/service";
import { foodLabelsFor } from "@/components/food/labels";
import { AppError } from "@/server/errors";

/** The customer's allergen book (PDF, its own language): what it buys × the 14 allergens + ingredients. Phase 44. */
export async function GET() {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const s = await foodSettings();
    if (!s.enabled || !s.sheet) return new Response("Switched off", { status: 404 });
    const { l, locale } = await foodLabelsFor(await getLocale());
    const items = await myFoodProducts(ctx, locale);
    const { renderAllergenBook } = await import("@/server/pdf/food");
    const pdf = await renderAllergenBook({ company: ctx.company.tradeName ?? ctx.company.legalName, locale, items, l });
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="allergens.pdf"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
