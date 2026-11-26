import { Printer, RefreshCw, Tags } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { labelCandidates, listLabels, slAccess, slCustomSize } from "@/server/labels/service";
import { printAccess, printCatalogue } from "@/server/servicing/printing";
import type { PrintProductRow } from "@/components/services/printing";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tile } from "@/components/motion/dashboard-kit";
import { AddLabels, LabelList, type SlAllow, type SlRow } from "@/components/labels/shelf-labels";

export const metadata = { title: "Shelf labels" };

/** Shop: price labels for the shelves — products bought on FIRINGI or till items, the product's own barcode, print PDF. */
export default async function ShelfLabelsPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.catalogue.view", "buyer.orders.place", "company.pos.manage", "company.pos.sell"]);
  const [t, locale, access] = await Promise.all([getTranslations("shelfLabels"), getLocale(), slAccess(ctx)]);
  if (!access.on) {
    return (<><PageHeader title={t("title")} description={t("intro")} icon={Tags} /><Card><CardContent className="py-8 text-sm text-muted-foreground" data-testid="sl-off">{t("off")}</CardContent></Card></>);
  }
  const [{ labels }, cand, custom, print] = await Promise.all([listLabels(ctx), labelCandidates(ctx, locale), slCustomSize(ctx), printAccess(ctx)]);
  // print suppliers that print shelf labels (Services › Printing)
  const n = (v: { toString(): string }) => Number(v.toString());
  const printProducts: PrintProductRow[] = print.order ? (await printCatalogue(ctx)).filter((p) => p.kind === "SHELF_LABELS" && !p.priceOnRequest).map((p) => ({ id: p.id, kind: p.kind, name: p.name, description: p.description, supplier: p.supplier, labelFormat: p.labelFormat, unitPriceNet: n(p.unitPriceNet), setupNet: n(p.setupNet), minQty: p.minQty, stepQty: p.stepQty, priceOnRequest: p.priceOnRequest, vatRate: n(p.vatRate), turnaroundDays: p.turnaroundDays, delivery: p.delivery, active: p.active })) : [];
  const s = access.settings;
  const allow: SlAllow = { brand: s.allowBrand, origin: s.allowOrigin, qr: s.allowQr, posSync: s.allowPosSync && can(ctx, "company.pos.manage"), manage: access.manage, till: can(ctx, ["company.pos.manage", "company.pos.sell"]), customSize: s.allowCustomSize };
  const rows: SlRow[] = labels.map((l) => ({
    id: l.id, name: l.name, barcode: l.barcode, brand: l.brand, originCountryCode: l.originCountryCode, offerId: l.offerId, posItemId: l.posItemId,
    priceGross: l.priceGross.toFixed(2), marginPct: l.marginPct?.toString() ?? null, promoPrice: l.promoPrice?.toFixed(2) ?? null, promoUntil: l.promoUntil?.toISOString() ?? null,
    content: l.content?.toString() ?? null, contentUnit: l.contentUnit, costNet: l.costNet, margin: l.margin, newPrice: l.newPrice, toPrint: l.toPrint, printedAt: l.printedAt?.toISOString() ?? null,
  }));
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} icon={Tags} />
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Tile icon={Tags} label={t("kpiLabels")} value={rows.length} locale={locale} tone="tone-teal" i={0} testId="kpi-labels" />
        <Tile icon={Printer} label={t("kpiToPrint")} value={rows.filter((r) => r.toPrint).length} locale={locale} tone="tone-orange" i={1} testId="kpi-toprint" />
        <Tile icon={RefreshCw} label={t("kpiNewPrices")} value={rows.filter((r) => r.newPrice).length} locale={locale} tone="tone-pink" i={2} />
      </div>
      <div className="grid gap-6">
        {access.manage && (
          <Card>
            <CardHeader><CardTitle>{t("addTitle")}</CardTitle><CardDescription>{t("addHint")}</CardDescription></CardHeader>
            <CardContent><AddLabels purchases={cand.purchases} till={cand.till} locale={locale} allow={allow} /></CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle>{t("listTitle")}</CardTitle><CardDescription>{t("listHint")}</CardDescription></CardHeader>
          <CardContent><LabelList key={rows.map((r) => r.id).join(",")} labels={rows} locale={locale} allow={allow} custom={custom} printProducts={printProducts} /></CardContent>
        </Card>
      </div>
    </>
  );
}
