import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { getOwnPriceList } from "@/server/services/pricing";
import { listOwnOffers } from "@/server/services/vendor-catalogue";
import { NotFoundError } from "@/server/errors";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { AddPriceForm, RemovePriceButton } from "@/components/vendor/pricing-controls";
import { formatMoney } from "@/lib/utils";

export default async function PriceListPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.pricing.manage");
  const { id } = await params;
  const pl = await getOwnPriceList(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const [offers, t, locale] = await Promise.all([listOwnOffers(ctx), getTranslations("catalogue.vendor"), getLocale()]);
  const L = (v: unknown) => pickLocalized(v, locale);
  return (
    <>
      <Link href="/vendor/products/price-lists" className="text-sm text-primary hover:underline">← {t("priceLists")}</Link>
      <PageHeader title={pl.name} description={`${t(`scopes.${pl.scope}`)}${pl.targetGroup ? ` · ${pl.targetGroup.name}` : ""}${pl.targetCompany ? ` · ${pl.targetCompany.legalName}` : ""}`} />
      <div className="mb-4"><AddPriceForm priceListId={pl.id} offers={offers.map((o) => ({ id: o.id, label: `${L(o.packaging.variant.product.name)} — ${L(o.packaging.name)}` }))} /></div>
      <Table>
        <THead><TR><TH>{t("product")}</TH><TH className="text-right">{t("minQty")}</TH><TH className="text-right">{t("price")}</TH><TH /></TR></THead>
        <TBody>
          {pl.items.map((i) => (
            <TR key={i.id}>
              <TD>{L(i.offer.packaging.variant.product.name)} <span className="text-xs text-muted-foreground">· {L(i.offer.packaging.name)}</span></TD>
              <TD className="text-right tabular-nums">{i.minQty}</TD>
              <TD className="text-right tabular-nums">{formatMoney(i.unitPriceNet.toString(), locale)}</TD>
              <TD className="text-right"><RemovePriceButton itemId={i.id} /></TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
