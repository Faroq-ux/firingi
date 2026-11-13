import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { CircleDollarSign, PackageCheck, PackageX, Truck } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { valuation } from "@/server/inventory/service";
import { offerLabel } from "@/server/inventory/options";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tile } from "@/components/motion/dashboard-kit";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Valuation" };
const PERIODS = [7, 30, 90, 365];

export default async function Valuation({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.reports.view"]);
  const sp = await searchParams;
  const days = PERIODS.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const [t, locale] = await Promise.all([getTranslations("inventory"), getLocale()]);
  const v = await valuation(ctx, { from: new Date(Date.now() - days * 86_400_000), to: new Date() });
  return (
    <>
      <PageHeader title={t("valuation")} description={t("method")} />
      <nav className="mb-4 flex flex-wrap gap-2 text-sm">{PERIODS.map((d) => <Link key={d} href={`?days=${d}`} className={`rounded-full border px-3 py-1 ${d === days ? "border-primary bg-primary/10 font-medium" : ""}`}>{t("lastDays", { days: d })}</Link>)}</nav>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="valuation-kpis">
        <Tile icon={CircleDollarSign} label={t("kpiValue")} value={Number(v.total)} fmt="money" locale={locale} tone="tone-violet" i={0} />
        <Tile icon={Truck} label={t("cogs")} value={Number(v.cogs)} fmt="money" locale={locale} tone="tone-blue" i={1} hint={t("lastDays", { days })} />
        <Tile icon={PackageCheck} label={t("receivedValue")} value={Number(v.received)} fmt="money" locale={locale} tone="tone-teal" i={2} hint={t("lastDays", { days })} />
        <Tile icon={PackageX} label={t("writtenOff")} value={Number(v.writtenOff)} fmt="money" locale={locale} tone="tone-pink" i={3} hint={t("lastDays", { days })} />
      </div>
      <Card className="mb-6"><CardHeader><CardTitle>{t("byWarehouse")}</CardTitle></CardHeader><CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {v.warehouses.map((w) => {
            const share = Number(v.total) ? (Number(w.value) / Number(v.total)) * 100 : 0;
            return (
              <div key={w.warehouse} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="min-w-0 break-words font-medium">{w.warehouse}</span><span className="whitespace-nowrap font-semibold tabular-nums">{formatMoney(w.value, locale)}</span></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[linear-gradient(90deg,var(--vivid-blue),var(--vivid-violet))]" style={{ width: `${share}%` }} /></div>
                <div className="mt-1 text-xs text-muted-foreground">{w.units} {t("units")} · {w.lines} {t("product")}</div>
              </div>
            );
          })}
        </div>
      </CardContent></Card>
      <Table data-testid="valuation-table">
        <THead><TR><TH>{t("product")}</TH><TH>{t("warehouse")}</TH><TH className="text-right">{t("onHand")}</TH><TH className="text-right">{t("avgCost")}</TH><TH className="text-right">{t("value")}</TH></TR></THead>
        <TBody>
          {v.rows.sort((a, b) => Number(b.value) - Number(a.value)).map((r) => (
            <TR key={`${r.offer.id}-${r.warehouse}`}><TD>{offerLabel(r.offer.product, r.offer.packaging, r.offer.sku, locale)}</TD><TD>{r.warehouse}</TD><TD className="text-right tabular-nums">{r.onHand}</TD><TD className="text-right tabular-nums">{Number(r.avgCost) ? formatMoney(r.avgCost, locale) : "—"}</TD><TD className="text-right tabular-nums">{formatMoney(r.value, locale)}</TD></TR>
          ))}
          <TR><TD colSpan={4} className="text-right font-semibold">{t("total")}</TD><TD className="text-right font-semibold tabular-nums">{formatMoney(v.total, locale)}</TD></TR>
        </TBody>
      </Table>
    </>
  );
}
