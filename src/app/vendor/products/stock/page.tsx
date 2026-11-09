import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listOwnOffers, stockLocations } from "@/server/services/vendor-catalogue";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { StockCell } from "@/components/vendor/offer-controls";

export const metadata = { title: "Stock" };

export default async function StockPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.stock.manage", "vendor.products.view"]);
  const [offers, locations, t, locale] = await Promise.all([listOwnOffers(ctx), stockLocations(ctx), getTranslations("catalogue.vendor"), getLocale()]);
  const editable = can(ctx, "vendor.stock.manage");
  return (
    <>
      <PageHeader title={t("stock")} />
      {locations.length === 0 ? <p className="text-sm text-muted-foreground">{t("noLocations")}</p> : (
        <Table>
          <THead><TR><TH>{t("product")}</TH>{locations.map((l) => <TH key={l.id} className="text-right">{l.label}</TH>)}</TR></THead>
          <TBody>
            {offers.map((o) => (
              <TR key={o.id}>
                <TD><div className="font-medium">{pickLocalized(o.packaging.variant.product.name, locale)}</div><div className="text-xs text-muted-foreground">{pickLocalized(o.packaging.name, locale)}</div></TD>
                {locations.map((l) => {
                  const s = o.stockLevels.find((x) => x.addressId === l.id);
                  return (
                    <TD key={l.id} className="text-right">
                      {editable ? <StockCell offerId={o.id} addressId={l.id} onHand={s?.onHand ?? 0} reserved={s?.reserved ?? 0} /> : <span className="tabular-nums">{s?.onHand ?? 0}</span>}
                    </TD>
                  );
                })}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
