import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { publicFood } from "@/server/food/service";
import { foodLabelsFor } from "@/components/food/labels";
import { FoodPanel } from "@/components/food/views";
import { localeFromAcceptLanguage } from "@/i18n/request";
import { UI_LOCALES } from "@/i18n/config";

export const metadata = { title: "Product information", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Phase 44 — the public product page behind a reseller's shelf QR code: approved food information only, in the
 * shopper's language (?lang= from the label, else the browser's), no prices, no supplier, no login.
 */
export default async function PublicFoodPage({ params, searchParams }: { params: Promise<{ productId: string }>; searchParams: Promise<{ lang?: string }> }) {
  const [{ productId }, sp] = await Promise.all([params, searchParams]);
  const browser = localeFromAcceptLanguage((await headers()).get("accept-language"));
  const { l, locale } = await foodLabelsFor(sp.lang ?? browser);
  const f = await publicFood(productId, locale);
  if (!f) notFound();
  const names = new Intl.DisplayNames([locale], { type: "language" });
  return (
    <div className="glass rounded-3xl p-5 text-foreground shadow-xl" data-testid="public-food">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{l.publicTitle}</p>
      <h1 className="mt-1 text-2xl font-bold leading-tight">{f.name}</h1>
      {f.brand && <p className="text-sm text-muted-foreground">{f.brand}</p>}
      <div className="mt-4"><FoodPanel f={{ ...f, hits: [] }} l={l} locale={locale} /></div>
      <p className="mt-4 text-xs text-muted-foreground">{l.labelDisclaimer}</p>
      <form className="mt-4 flex items-center gap-2 text-xs" method="get">
        <label htmlFor="lang" className="text-muted-foreground">{l.language}</label>
        <select id="lang" name="lang" defaultValue={locale} className="h-8 rounded-md border bg-background px-2" data-testid="public-food-lang">
          {UI_LOCALES.map((c) => <option key={c} value={c}>{(() => { try { return names.of(c) ?? c; } catch { return c; } })()}</option>)}
        </select>
        <button type="submit" className="h-8 rounded-md border px-2">OK</button>
      </form>
      <p className="mt-3 text-[11px] text-muted-foreground">{l.poweredBy}</p>
    </div>
  );
}
