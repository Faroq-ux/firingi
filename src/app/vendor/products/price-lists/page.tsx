import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { eligibleBuyers, ensureBaseList, listCurrencies, listOwnGroups, listOwnPriceLists } from "@/server/services/pricing";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { NewPriceListForm } from "@/components/vendor/pricing-controls";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Price lists" };

export default async function PriceListsPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.pricing.manage");
  await ensureBaseList(ctx);
  const [lists, groups, buyers, t, tc, cur] = await Promise.all([listOwnPriceLists(ctx), listOwnGroups(ctx), eligibleBuyers(ctx), getTranslations("catalogue.vendor"), getTranslations("currency"), listCurrencies(ctx)]);
  return (
    <>
      <PageHeader title={t("priceLists")} description={t("pricingIntro")} />
      <div className="mb-4">
        <NewPriceListForm groups={groups.map((g) => ({ id: g.id, label: g.name }))} customers={buyers.map((b) => ({ id: b.id, label: `${b.country.flag ?? ""} ${b.tradeName ?? b.legalName}` }))} currencies={cur.allowed} own={cur.own} />
      </div>
      <Table>
        <THead><TR><TH>{t("name")}</TH><TH>{t("scope")}</TH><TH>{t("target")}</TH><TH>{t("priority")}</TH><TH>{tc("currency")}</TH><TH>{t("validFrom")} → {t("validTo")}</TH><TH className="text-right">{t("items")}</TH></TR></THead>
        <TBody>
          {lists.map((l) => (
            <TR key={l.id}>
              <TD><Link href={`/vendor/products/price-lists/${l.id}`} className="font-medium text-primary hover:underline">{l.name}</Link>{!l.isActive && <Badge variant="secondary" className="ml-1">off</Badge>}</TD>
              <TD><Badge variant={l.scope === "BASE" ? "secondary" : "default"}>{t(`scopes.${l.scope}`)}</Badge></TD>
              <TD>{l.targetGroup?.name ?? l.targetCompany?.legalName ?? "—"}</TD>
              <TD>{l.priority}</TD>
              <TD className="tabular-nums">{l.currencyCode}</TD>
              <TD className="text-xs text-muted-foreground">{formatDate(l.validFrom)} → {l.validTo ? formatDate(l.validTo) : "∞"}</TD>
              <TD className="text-right tabular-nums">{l._count.items}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
