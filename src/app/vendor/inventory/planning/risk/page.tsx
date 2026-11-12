import { Hourglass } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { myRisk } from "@/server/planning/service";
import { rowLabel, type RiskRow } from "@/server/planning/engine";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RiskActions, type RiskActionView } from "@/components/planning/vendor";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Overstock & expiry" };

const view = (r: RiskRow): RiskActionView =>
  r.action.kind === "TRANSFER" ? { kind: "TRANSFER", offerId: r.offerId, fromAddressId: r.addressId, toAddressId: r.action.toAddressId, to: r.action.to, qty: r.action.qty, risk: r.kind }
    : r.action.kind === "MARKDOWN" ? { kind: "MARKDOWN", batchId: r.action.batchId, pct: r.action.pct, enabled: r.action.enabled }
      : { kind: r.action.kind };

export default async function Risk() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.purchasing.manage"]);
  const [d, t, locale] = await Promise.all([myRisk(ctx), getTranslations("planning"), getLocale()]);
  const manage = can(ctx, "vendor.inventory.manage");
  const expiry = d.rows.filter((r) => r.kind === "EXPIRY"), over = d.rows.filter((r) => r.kind === "OVERSTOCK");
  const total = (rs: RiskRow[]) => formatMoney(rs.reduce((a, r) => a + r.value, 0), locale);
  const nf = (v: number) => v.toLocaleString(locale, { maximumFractionDigits: 1 });
  const List = ({ rows, empty, testId }: { rows: RiskRow[]; empty: string; testId: string }) => (
    <ul className="divide-y" data-testid={testId}>
      {rows.length === 0 && <li className="py-3 text-sm text-muted-foreground">{empty}</li>}
      {rows.map((r) => (
        <li key={r.key} className="space-y-2 py-3" data-testid={`risk-${r.key}`}>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{rowLabel(r, locale)}</span>
              <Badge variant={r.kind === "EXPIRY" ? (r.batch?.expired ? "destructive" : "warning") : "secondary"}>{r.kind === "EXPIRY" ? (r.batch?.expired ? t("expired") : t("daysLeft", { days: r.batch!.daysLeft })) : r.noSales ? t("noSales") : t("coverDays", { days: r.coverDays ?? 365 })}</Badge>
            </p>
            <p className="text-xs text-muted-foreground">
              {r.warehouse}
              {r.batch ? ` · ${t("lot", { lot: r.batch.lotCode ?? "—", date: formatDate(r.batch.expiresOn, locale) })} · ${t("willSell", { sells: r.batch.sells, free: r.batch.free })}` : ` · ${t("sellsPerDay", { qty: nf(r.dailyDemand) })}`}
            </p>
            <p className="text-sm"><span className="font-semibold tabular-nums">{t("atRisk", { units: r.units })}</span> <span className="text-muted-foreground">· {formatMoney(r.value, locale)}</span></p>
          </div>
          <RiskActions riskKey={r.key} action={view(r)} canManage={manage} />
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <PageHeader title={t("riskTitle")} description={t("riskIntro", { days: d.cp.settings.overstockDays })} icon={Hourglass} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("expiryTitle")} · {total(expiry)}</CardTitle><CardDescription>{t("expiryHint")}</CardDescription></CardHeader>
          <CardContent><List rows={expiry} empty={t("noExpiryRisk")} testId="expiry-risk" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("overstockTitle")} · {total(over)}</CardTitle><CardDescription>{t("overstockHint", { days: d.cp.settings.overstockDays })}</CardDescription></CardHeader>
          <CardContent><List rows={over} empty={t("noOverstock")} testId="overstock-risk" /></CardContent>
        </Card>
      </div>
      {d.hidden > 0 && <p className="mt-4 text-xs text-muted-foreground">{t("hiddenCount", { count: d.hidden })}</p>}
    </>
  );
}
