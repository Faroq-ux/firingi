import Link from "next/link";
import { Gauge, Layers, PackageX, ShieldAlert } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listChargebacks, myQuality } from "@/server/claims/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tile } from "@/components/motion/dashboard-kit";
import { CHARGEBACK_TONE } from "@/components/claims/views";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Quality Score" };

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.claims.respond", "vendor.orders.view"]);
  const [q, cbs, t, locale] = await Promise.all([myQuality(ctx), listChargebacks(ctx, "VENDOR").catch(() => []), getTranslations("claims"), getLocale()]);
  const pct = (v: number | null) => (v === null ? "—" : new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(v));
  const over = q.rate !== null && q.rate * 100 >= q.threshold;
  return (
    <>
      <PageHeader title={t("quality.title")} description={t("quality.intro", { days: q.days, threshold: q.threshold })} icon={Gauge} />
      {q.alerts.length > 0 && (
        <Card className="mb-6 border-2 border-[color:color-mix(in_oklch,var(--destructive)_40%,var(--border))]" data-testid="vendor-quality-alerts">
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="size-5 text-destructive" aria-hidden />{t("quality.alerts")}</CardTitle></CardHeader>
          <CardContent><ul className="space-y-1 text-sm">{q.alerts.map((a) => <li key={a.id} className="break-words">{t(`quality.alert.${a.kind}`, { label: a.label, value: a.kind === "LOT" ? String(a.value) : pct(a.value / 100), threshold: a.kind === "LOT" ? String(a.threshold) : pct(a.threshold / 100) })}</li>)}</ul></CardContent>
        </Card>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={Gauge} label={t("kpi.claimRate")} value={q.rate ?? undefined} fmt="percent" locale={locale} tone={over ? "tone-pink" : "tone-teal"} i={0} hint={t("quality.threshold", { threshold: q.threshold })} testId="quality-rate" />
        <Tile icon={PackageX} label={t("quality.upheld")} value={q.upheld} locale={locale} tone="tone-orange" i={1} hint={t("quality.ofClaims", { claims: q.claims })} />
        <Tile icon={Layers} label={t("quality.delivered")} value={q.delivered} locale={locale} tone="tone-blue" i={2} />
        <Tile icon={ShieldAlert} label={t("kpi.chargebacksOpen")} value={cbs.filter((c) => c.status === "OPEN" || c.status === "DISPUTED").reduce((a, c) => a + c.amount, 0)} fmt="money" locale={locale} tone="tone-violet" i={3} />
      </div>
      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("quality.byProduct")}</CardTitle><CardDescription>{t("quality.byProductHint")}</CardDescription></CardHeader>
          <CardContent>
            <Table data-testid="quality-products">
              <THead><TR><TH>{t("products")}</TH><TH className="text-right">{t("quality.claimedUnits")}</TH><TH className="text-right">{t("quality.deliveredUnits")}</TH><TH className="text-right">{t("quality.rate")}</TH></TR></THead>
              <TBody>
                {q.products.map((p) => <TR key={p.offerId}><TD className="break-words">{p.product}</TD><TD className="text-right tabular-nums">{p.claimed}</TD><TD className="text-right tabular-nums">{p.units}</TD><TD className="text-right tabular-nums">{pct(p.rate)}</TD></TR>)}
                {!q.products.length && <EmptyRow colSpan={4}>{t("quality.none")}</EmptyRow>}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("quality.byLot")}</CardTitle><CardDescription>{t("quality.byLotHint")}</CardDescription></CardHeader>
          <CardContent>
            <Table data-testid="quality-lots">
              <THead><TR><TH>{t("lot")}</TH><TH>{t("products")}</TH><TH className="text-right">{t("quality.claims")}</TH><TH className="text-right">{t("quality.claimedUnits")}</TH></TR></THead>
              <TBody>
                {q.lots.map((l) => <TR key={`${l.lotCode}-${l.product}`}><TD className="font-mono text-xs">{l.lotCode}</TD><TD className="break-words">{l.product}</TD><TD className="text-right tabular-nums">{l.claims}</TD><TD className="text-right tabular-nums">{l.units}</TD></TR>)}
                {!q.lots.length && <EmptyRow colSpan={4}>{t("quality.none")}</EmptyRow>}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>{t("chargeback.title")}</CardTitle><CardDescription>{t("chargeback.hint")}</CardDescription></CardHeader>
        <CardContent>
          <Table data-testid="vendor-chargeback-list">
            <THead><TR><TH>{t("claim")}</TH><TH>{t("order")}</TH><TH className="text-right">{t("chargeback.amount")}</TH><TH>{t("statusCol")}</TH><TH>{t("chargeback.statement")}</TH></TR></THead>
            <TBody>
              {cbs.map((c) => (
                <TR key={c.id}>
                  <TD><Link href={`/vendor/orders/claims/${c.claimId}`} className="font-medium text-primary hover:underline">{c.claimNumber}</Link></TD>
                  <TD>{c.orderNumber}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(c.amount, locale)}</TD>
                  <TD><Badge variant={CHARGEBACK_TONE[c.status]}>{t(`chargeback.status.${c.status}`)}</Badge></TD>
                  <TD className="font-mono text-xs">{c.statement ? <Link href="/vendor/finance/statements" className="hover:underline">{c.statement.number}</Link> : "—"}</TD>
                </TR>
              ))}
              {!cbs.length && <EmptyRow colSpan={5}>{t("chargeback.none")}</EmptyRow>}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
