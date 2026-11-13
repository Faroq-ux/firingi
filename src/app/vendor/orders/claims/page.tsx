import Link from "next/link";
import { AlertTriangle, Clock, Gauge, ReceiptEuro, Truck } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listChargebacks, listClaims, myQuality } from "@/server/claims/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tile } from "@/components/motion/dashboard-kit";
import { CLAIM_STATUS_TONE } from "@/components/claims/views";

export const metadata = { title: "Quality Claims" };
const STATUSES = ["OPEN", "APPROVED", "REJECTED", "WITHDRAWN"] as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.claims.respond", "vendor.orders.view"]);
  const sp = await searchParams;
  const status = STATUSES.find((x) => x === sp.status);
  const [all, cbs, q, t, locale] = await Promise.all([listClaims(ctx, "VENDOR"), listChargebacks(ctx, "VENDOR").catch(() => []), myQuality(ctx), getTranslations("claims"), getLocale()]);
  const rows = status ? all.filter((r) => r.status === status) : all;
  const fmt = (d: Date) => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" }).format(d);
  const waiting = all.filter((r) => r.status === "OPEN" && !r.supplierResponse).length;
  return (
    <>
      <PageHeader title={t("title")} description={t("vendorIntro")} icon={AlertTriangle} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={Clock} label={t("kpi.toAnswer")} value={waiting} locale={locale} tone="tone-orange" i={0} href="?status=OPEN" testId="kpi-to-answer" />
        <Tile icon={Truck} label={t("kpi.replacements")} value={all.filter((r) => r.replacementPending).length} locale={locale} tone="tone-blue" i={1} />
        <Tile icon={ReceiptEuro} label={t("kpi.chargebacksOpen")} value={cbs.filter((c) => c.status === "OPEN" || c.status === "DISPUTED").reduce((a, c) => a + c.amount, 0)} fmt="money" locale={locale} tone="tone-pink" i={2} />
        <Tile icon={Gauge} label={t("kpi.claimRate")} value={q.rate ?? undefined} fmt="percent" locale={locale} tone={q.rate !== null && q.rate * 100 >= q.threshold ? "tone-pink" : "tone-teal"} i={3} href="/vendor/orders/claims/quality" testId="kpi-claim-rate"
          hint={t("kpi.claimRateHint", { upheld: q.upheld, delivered: q.delivered })} />
      </div>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <Link href="?" className={!status ? "font-semibold" : "text-muted-foreground hover:underline"}>{t("all")}</Link>
        {STATUSES.map((x) => <Link key={x} href={`?status=${x}`} className={status === x ? "font-semibold" : "text-muted-foreground hover:underline"}>{t(`status.${x}`)}</Link>)}
        <Link href="/vendor/orders/claims/quality" className="ml-auto font-medium text-primary hover:underline">{t("qualityLink")}</Link>
      </div>
      <Card><CardContent className="pt-5">
        <Table data-testid="claims-table">
          <THead><TR><TH>{t("claim")}</TH><TH>{t("order")}</TH><TH>{t("customer")}</TH><TH>{t("reasonCol")}</TH><TH>{t("products")}</TH><TH>{t("statusCol")}</TH><TH>{t("yourAnswer")}</TH><TH>{t("opened")}</TH></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD><Link href={`/vendor/orders/claims/${r.id}`} className="font-medium text-primary hover:underline">{r.number}</Link></TD>
                <TD><Link href={`/vendor/orders/${r.orderId}`} className="hover:underline">{r.orderNumber}</Link></TD>
                <TD>{r.buyer}</TD>
                <TD>{t(`reason.${r.reason}`)}</TD>
                <TD className="max-w-64 break-words">{r.products}<div className="text-xs text-muted-foreground">{t("units", { qty: r.units })}</div></TD>
                <TD><Badge variant={CLAIM_STATUS_TONE[r.status]}>{t(`status.${r.status}`)}</Badge>{r.replacementPending && <div className="mt-1 text-xs text-muted-foreground">{t("replacementPending")}</div>}</TD>
                <TD>{r.supplierResponse ? t(`respond.${r.supplierResponse}`) : r.status === "OPEN" ? <Badge variant="warning">{t("answerNeeded")}</Badge> : "—"}</TD>
                <TD className="whitespace-nowrap">{fmt(r.createdAt)}</TD>
              </TR>
            ))}
            {!rows.length && <EmptyRow colSpan={8}>{t("emptyVendor")}</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
