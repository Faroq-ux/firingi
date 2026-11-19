import { getLocale, getTranslations } from "next-intl/server";
import type { CatalogueItem } from "@/server/data/catalogue-buyer";
import { formatMoney } from "@/lib/utils";

/**
 * Price incl. local tax (IVA / VAT …) prominently, net price and tax below. Phase 45: a customer billed in its own
 * currency sees the prices in it (a fixed local price exactly), with the EUR price alongside when FIRINGI shows it.
 */
export async function PriceBlock({ item, size = "md" }: { item: CatalogueItem; size?: "md" | "lg" }) {
  if (!item.price) return null;
  const [t, tc, locale] = await Promise.all([getTranslations("catalogue"), getTranslations("currency"), getLocale()]);
  const tax = item.taxLabel;
  const p = item.price;
  const l = p.local;
  const code = l?.code ?? "EUR";
  const m = (v: string) => formatMoney(v, locale, code);
  const shown = l ? { listUnitGross: l.listUnitGross, unitPriceGross: l.unitPriceGross, unitPriceNet: l.unitPriceNet, perUnitGross: l.perUnitGross } : p;
  const vat = l ? (Number(l.unitPriceGross) - Number(l.unitPriceNet)).toFixed(code === "ISK" ? 0 : 2) : p.vatAmount;
  const promo = p.promotions.length > 0;
  return (
    <div className="space-y-0.5" data-currency={code}>
      {promo && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground line-through tabular-nums">{m(shown.listUnitGross)}</span>
          {p.promotions.map((x) => <span key={x.id} className="animate-pop rounded-full bg-destructive/15 px-2 py-0.5 font-medium text-destructive">{x.name || "Promo"}</span>)}
        </div>
      )}
      <div className={(size === "lg" ? "text-3xl font-semibold tabular-nums" : "text-lg font-semibold tabular-nums") + (promo ? " text-destructive" : "")} data-testid="price-gross">
        {m(shown.unitPriceGross)} <span className="text-xs font-normal text-muted-foreground">{t("incTax", { tax })}</span>
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        {m(shown.unitPriceNet)} {t("exTax", { tax })} · {t("taxAmount", { tax, rate: Number(item.vatRate).toLocaleString(locale), amount: m(vat) })}
      </div>
      {item.packaging.unitsPerPack > 1 && (
        <div className="text-xs text-muted-foreground">{t("perUnitGross", { price: m(shown.perUnitGross), tax })}</div>
      )}
      {l?.showEur && <div className="text-[11px] text-muted-foreground tabular-nums" data-testid="price-eur">{tc("approxEur", { amount: formatMoney(p.unitPriceGross, locale) })}</div>}
    </div>
  );
}

/** SKU + barcode line shown on every product card / page. */
export async function Codes({ item, full = false }: { item: CatalogueItem; full?: boolean }) {
  const t = await getTranslations("catalogue");
  return (
    <div className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
      <div>{t("sku")} {item.sku}{item.vendorSku ? ` · ${item.vendorSku}` : ""}</div>
      {item.gtin && <div>▮▯▮ {item.gtin}</div>}
      {full && item.unitGtin && item.unitGtin !== item.gtin && <div>{t("unitBarcodeLabel")}: {item.unitGtin}</div>}
    </div>
  );
}
