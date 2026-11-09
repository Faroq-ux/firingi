import { getLocale, getTranslations } from "next-intl/server";
import type { CatalogueItem } from "@/server/data/catalogue-buyer";
import { formatMoney } from "@/lib/utils";

/** Price incl. local tax (IVA / VAT …) prominently, net price and tax below. */
export async function PriceBlock({ item, size = "md" }: { item: CatalogueItem; size?: "md" | "lg" }) {
  if (!item.price) return null;
  const [t, locale] = await Promise.all([getTranslations("catalogue"), getLocale()]);
  const tax = item.taxLabel;
  const p = item.price;
  return (
    <div className="space-y-0.5">
      <div className={size === "lg" ? "text-3xl font-semibold tabular-nums" : "text-lg font-semibold tabular-nums"}>
        {formatMoney(p.unitPriceGross, locale)} <span className="text-xs font-normal text-muted-foreground">{t("incTax", { tax })}</span>
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        {formatMoney(p.unitPriceNet, locale)} {t("exTax", { tax })} · {t("taxAmount", { tax, rate: Number(item.vatRate).toLocaleString(locale), amount: formatMoney(p.vatAmount, locale) })}
      </div>
      {item.packaging.unitsPerPack > 1 && (
        <div className="text-xs text-muted-foreground">{t("perUnitGross", { price: formatMoney(p.perUnitGross, locale), tax })}</div>
      )}
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
