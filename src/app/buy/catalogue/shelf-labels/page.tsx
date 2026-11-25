import { Printer, RefreshCw, Tags } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { labelCandidates, listLabels, slAccess } from "@/server/labels/service";
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
  const [{ labels }, cand] = await Promise.all([listLabels(ctx), labelCandidates(ctx, locale)]);
  const s = access.settings;
  const allow: SlAllow = { brand: s.allowBrand, origin: s.allowOrigin, qr: s.allowQr, posSync: s.allowPosSync && can(ctx, "company.pos.manage"), manage: access.manage, till: can(ctx, ["company.pos.manage", "company.pos.sell"]) };
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
          <CardContent><LabelList key={rows.map((r) => r.id).join(",")} labels={rows} locale={locale} allow={allow} /></CardContent>
        </Card>
      </div>
    </>
  );
}
