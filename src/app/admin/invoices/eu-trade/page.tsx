import Link from "next/link";
import { Globe2 } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { tradeEntities, tradeOverview } from "@/server/trade/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OpenPeriodForm, RefreshButton } from "@/components/trade/admin";
import { ReturnsTable, eur } from "@/components/trade/views";

export const metadata = { title: "EU Trade Reporting" };
export const dynamic = "force-dynamic";

export default async function EuTradePage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage", "admin.tax.manage", "admin.invoices.view"]);
  const [ov, ents] = await Promise.all([tradeOverview(ctx), tradeEntities(ctx)]);
  const manage = can(ctx, ["admin.tax.manage", "admin.finance.manage"]);
  const open = ov.returns.filter((r) => r.status !== "FILED");
  const tiles = [
    { label: "Returns to file", value: open.filter((r) => r.obliged || r.lines > 0).length, href: "/admin/invoices/eu-trade/returns?status=OPEN" },
    { label: "Lines with missing customs data", value: ov.dataProblems, href: "/admin/invoices/eu-trade/codes?missing=1" },
    { label: "Lines with VAT number problems", value: ov.vatProblems, href: "/admin/invoices/eu-trade/vies" },
    { label: "Supplier codes to check", value: ov.pendingCodes, href: "/admin/invoices/eu-trade/codes" },
  ];
  return (
    <>
      <PageHeader title="EU Trade Reporting" icon={Globe2} description="EC Sales List and Intrastat for FIRINGI's entities — built from the issued invoices and supplier statements, checked, downloaded in each country's layout and marked filed." />
      {!ov.settings.enabled && <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">EU trade reporting is switched off in Settings › EU Trade Reporting.</p>}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="trade-tiles">
        {tiles.map((t) => <Link key={t.label} href={t.href}><Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{t.label}</p><p className="text-xl font-semibold tabular-nums">{t.value}</p></CardContent></Card></Link>)}
      </div>
      <Card className="mb-6">
        <CardHeader><CardTitle>Current returns</CardTitle><CardDescription>Open returns are rebuilt every night from the documents; a filed return never changes — later credits go into the next one as corrections.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {manage && <RefreshButton />}
          <ReturnsTable rows={ov.returns} />
          <p className="text-sm"><Link className="underline" href="/admin/invoices/eu-trade/returns">All returns</Link> · <Link className="underline" href="/admin/settings/eu-trade">Settings, thresholds and deadlines</Link></p>
          {manage && <div className="border-t pt-4"><p className="mb-2 text-sm font-medium">Open another period</p><OpenPeriodForm entities={ents} /></div>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Intrastat thresholds</CardTitle><CardDescription>Goods value this year and last year against each country&apos;s threshold. Once over, tick &quot;Must file&quot; in the settings — from then on the reminders cover Intrastat too.</CardDescription></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm" data-testid="trade-thresholds">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Entity</th><th>Flow</th><th className="text-right">This year</th><th className="text-right">Last year</th><th className="text-right">Threshold</th><th>Status</th></tr></thead>
              <tbody>
                {ov.thresholds.map((t) => (
                  <tr key={`${t.entityId}-${t.flow}`} className="border-t">
                    <td className="py-1.5">{t.country} · {t.entity}</td>
                    <td>{t.flow === "ARRIVALS" ? "Arrivals" : "Dispatches"}</td>
                    <td className="text-right tabular-nums">{eur(t.ytd)}</td>
                    <td className="text-right tabular-nums">{eur(t.lastYear)}</td>
                    <td className="text-right tabular-nums">{t.threshold > 0 ? eur(t.threshold) : "None (authority decides)"}</td>
                    <td>{t.obliged ? <Badge variant="default">Must file</Badge> : t.over ? <Badge variant="destructive">Over — must file</Badge> : t.pct != null && t.pct >= ov.settings.thresholds.warnAtPct ? <Badge variant="warning">{t.pct}% of threshold</Badge> : <span className="text-xs text-muted-foreground">{t.pct != null ? `${t.pct}%` : "—"}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
