import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myPurchasedLots } from "@/server/inventory/purchased";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { MarkUsed } from "@/components/inventory/purchased";

export const metadata = { title: "Expiring purchases" };

export default async function ExpiringPurchases() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place"]);
  const [t, locale] = await Promise.all([getTranslations("purchased"), getLocale()]);
  const rows = await myPurchasedLots(ctx, locale);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  return (
    <>
      <PageHeader title={t("title")} description={t("hint")} />
      <Table data-testid="purchased-lots">
        <THead><TR><TH>{t("product")}</TH><TH>{t("order")}</TH><TH>{t("lot")}</TH><TH>{t("bestBefore")}</TH><TH className="text-right">{t("delivered")}</TH><TH className="text-right">{t("unsold")}</TH><TH /></TR></THead>
        <TBody>
          {rows.length === 0 && <TR><TD colSpan={7} className="py-6 text-center text-muted-foreground">{t("none")}</TD></TR>}
          {rows.map((r) => (
            <TR key={r.id} data-testid="purchased-row">
              <TD className="font-medium">{r.product}</TD>
              <TD><Link className="font-mono text-sm hover:underline" href={`/buy/orders/${r.order.id}`}>{r.order.number}</Link></TD>
              <TD>{r.lotCode ?? "—"}</TD>
              <TD><Badge variant={r.daysLeft < 0 ? "destructive" : r.daysLeft <= 7 ? "warning" : "secondary"}>{date.format(r.expiresOn)} · {r.daysLeft < 0 ? t("expired") : t("days", { days: r.daysLeft })}</Badge></TD>
              <TD className="text-right tabular-nums">{r.qty}</TD>
              <TD className="text-right font-semibold tabular-nums">{r.unsold}</TD>
              <TD className="text-right">{r.inStock ? <span className="text-xs text-muted-foreground" title={t("inStockHint")}>{t("inStock")}</span> : <MarkUsed id={r.id} max={r.unsold} />}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
