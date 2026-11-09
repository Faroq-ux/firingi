import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { ownCommission } from "@/server/data/self-service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/utils";

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.invoices.view", "vendor.payments.view"]);
  const [c, t, locale] = await Promise.all([ownCommission(ctx), getTranslations("finance"), getLocale()]);
  return (
    <>
      <PageHeader title={t("commission")} />
      <Card className="mb-4"><CardContent className="pt-5">
        <p className="text-sm text-muted-foreground">{t("commissionRate")}</p>
        <p className="text-3xl font-semibold">{c.current ? `${Number(c.current.rate)} %` : "—"}</p>
        {c.current && <p className="text-xs text-muted-foreground">{formatDate(c.current.validFrom, locale)}</p>}
      </CardContent></Card>
      <h2 className="mb-2 font-semibold">{t("earned")}</h2>
      <Table>
        <THead><TR><TH>{t("order")}</TH><TH>{t("date")}</TH><TH className="text-right">{t("net")}</TH><TH className="text-right">{t("commission")}</TH><TH className="text-right">Payout</TH></TR></THead>
        <TBody>{c.orders.map((o) => <TR key={o.id}><TD className="font-mono text-xs">{o.number}</TD><TD className="text-xs">{formatDate(o.placedAt, locale)}</TD><TD className="text-right tabular-nums">{formatMoney(o.netTotal.toString(), locale)}</TD><TD className="text-right tabular-nums">{formatMoney(o.commissionTotal.toString(), locale)}</TD><TD className="text-right tabular-nums">{formatMoney(o.vendorPayableNet.toString(), locale)}</TD></TR>)}</TBody>
      </Table>
    </>
  );
}
