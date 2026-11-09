import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listOwnOffers, searchMasterCatalogue } from "@/server/services/vendor-catalogue";
import { catalogueOptions } from "@/server/data/catalogue-admin";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { BasePriceCell, OfferActiveToggle, ProposeProductForm, SellThisForm } from "@/components/vendor/offer-controls";

export const metadata = { title: "My products" };

const STATUS_VARIANT = { ACTIVE: "success", PAUSED: "secondary", PENDING_APPROVAL: "warning", REJECTED: "destructive", ARCHIVED: "secondary" } as const;

export default async function VendorProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; find?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.products.view", "vendor.products.manage"]);
  const sp = await searchParams;
  const canManage = can(ctx, "vendor.products.manage");
  const canPrice = can(ctx, "vendor.pricing.manage");
  const [offers, t, c, locale, options, found] = await Promise.all([
    listOwnOffers(ctx, { q: sp.q }),
    getTranslations("catalogue.vendor"),
    getTranslations("common"),
    getLocale(),
    canManage ? catalogueOptions() : null,
    canManage && sp.find ? searchMasterCatalogue(ctx, sp.find) : null,
  ]);
  const L = (v: unknown) => pickLocalized(v, locale);

  return (
    <>
      <PageHeader title={t("myProducts")} />
      <form className="mb-4 flex gap-2" action="/vendor/products/catalogue">
        <Input name="q" defaultValue={sp.q} placeholder={c("search")} className="max-w-sm" />
        <Button type="submit" variant="outline">{c("search")}</Button>
      </form>
      <Table>
        <THead><TR><TH>{t("product")}</TH><TH>{t("status")}</TH><TH>{t("basePrice")}</TH><TH className="text-right">{t("stock")}</TH><TH className="text-right">{t("actions")}</TH></TR></THead>
        <TBody>
          {offers.length === 0 && <EmptyRow colSpan={5}>{c("noData")}</EmptyRow>}
          {offers.map((o) => {
            const p = o.packaging.variant.product;
            const base = o.prices.find((x) => x.minQty === 1);
            const stock = o.stockLevels.reduce((a, s) => a + s.onHand - s.reserved, 0);
            return (
              <TR key={o.id}>
                <TD>
                  <div className="font-medium">{L(p.name)}</div>
                  <div className="text-xs text-muted-foreground">{L(o.packaging.name)} · SKU {o.packaging.variant.sku}{o.vendorSku ? ` · ${o.vendorSku}` : ""}</div>
                  {(o.packaging.gtin ?? o.packaging.variant.gtin) && <div className="font-mono text-[11px] text-muted-foreground">▮▯▮ {o.packaging.gtin ?? o.packaging.variant.gtin}</div>}
                  {o.reviewNote && <div className="text-xs text-destructive">{t("reviewNote")}: {o.reviewNote}</div>}
                </TD>
                <TD><Badge variant={STATUS_VARIANT[o.status]}>{t(`offerStatus.${o.status}`)}</Badge></TD>
                <TD><BasePriceCell offerId={o.id} price={base ? Number(base.unitPriceNet).toFixed(2) : null} canEdit={canPrice} /></TD>
                <TD className="text-right tabular-nums">{stock}</TD>
                <TD className="text-right">{canManage && <OfferActiveToggle offerId={o.id} status={o.status} />}</TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      {canManage && options && (
        <div className="mt-8 space-y-6">
          <Card>
            <CardHeader><CardTitle>{t("addFromCatalogue")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <form className="flex gap-2" action="/vendor/products/catalogue">
                <Input name="find" defaultValue={sp.find} placeholder={t("searchCatalogue")} className="max-w-md" />
                <Button type="submit" variant="outline">{c("search")}</Button>
              </form>
              {found && (
                <ul className="divide-y rounded-lg border">
                  {found.length === 0 && <li className="p-3 text-sm text-muted-foreground">{c("noData")}</li>}
                  {found.flatMap((p) => p.variants.flatMap((v) => v.packagings.map((pk) => (
                    <li key={pk.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                      <div>
                        <div className="font-medium">{L(p.name)} {p.brand && <span className="text-muted-foreground">· {p.brand.name}</span>}</div>
                        <div className="text-xs text-muted-foreground">{L(pk.name)} · SKU {v.sku}{(pk.gtin ?? v.gtin) ? ` · ▮▯▮ ${pk.gtin ?? v.gtin}` : ""} · {L(p.category.name)}</div>
                      </div>
                      {pk.offers.length ? <Badge variant="secondary">{t("alreadyOffered")}</Badge> : <SellThisForm packagingUnitId={pk.id} canPrice={canPrice} />}
                    </li>
                  ))))}
                </ul>
              )}
            </CardContent>
          </Card>
          <ProposeProductForm
            canPrice={canPrice}
            categories={options.categories.filter((x) => x.isActive).map((x) => ({ id: x.id, label: `${"— ".repeat(x.depth)}${L(x.name)}` }))}
            brands={options.brands.map((b) => ({ id: b.id, label: b.name }))}
            taxCategories={options.taxCategories.map((x) => ({ id: x.id, label: x.code }))}
            units={options.units.map((u) => ({ id: u.code, label: `${u.code} — ${L(u.name)}` }))}
          />
        </div>
      )}
    </>
  );
}
