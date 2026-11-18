import Link from "next/link";
import type { CSSProperties } from "react";
import { Activity, AlarmClock, BadgeCheck, Gauge, ShieldAlert } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { qualityOverview } from "@/server/claims/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tile } from "@/components/motion/dashboard-kit";
import { AcknowledgeAlert } from "@/components/claims/forms";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Quality & Alerts" };
const REASON: Record<string, string> = { DAMAGED: "Damaged", MISSING: "Missing", WRONG_PRODUCT: "Wrong product", TEMPERATURE: "Temperature", SHORT_DATED: "Short-dated", QUALITY: "Quality" };
const KIND: Record<string, string> = { SUPPLIER_RATE: "Supplier claim rate", PRODUCT_RATE: "Product claim rate", LOT: "Lot", DRIVER: "FIRINGI driver" };
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

export default async function Page({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.claims.manage", "admin.orders.view", "admin.orders.manage"]);
  const days = [30, 90, 365].includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 30;
  const q = await qualityOverview(ctx, days);
  // Phase 42: cold-chain breaches count in the scores (when FIRINGI says so)
  const { breachCounts, coldChainSettings } = await import("@/server/coldchain/service");
  const ccs = await coldChainSettings();
  const cold = ccs.enabled && ccs.actions.score ? await breachCounts(q.days) : null;
  const manage = can(ctx, "admin.claims.manage");
  const maxReason = Math.max(1, ...q.byReason.map((r) => r.count));
  const tones = ["var(--vivid-pink)", "var(--vivid-orange)", "var(--vivid-violet)", "var(--vivid-blue)", "var(--vivid-teal)", "var(--vivid-lime)"];
  return (
    <>
      <PageHeader title="Quality & Alerts" description={`Claim rates per supplier, product, lot and FIRINGI driver. Upheld supplier-fault claims lower the supplier's scorecard and its reliability in allocation. Alerts fire daily when a threshold is crossed (supplier ${q.settings.supplierRatePct}%, product ${q.settings.productRatePct}%, ${q.settings.lotClaims} claims on one lot, ${q.settings.driverClaims} on one driver — last 30 days).`} icon={Gauge}
        actions={<div className="flex gap-3 text-sm">{[30, 90, 365].map((n) => <Link key={n} href={`?days=${n}`} className={n === days ? "font-semibold" : "text-muted-foreground hover:underline"}>{n} days</Link>)}</div>} />
      {q.alerts.length > 0 && (
        <Card className="mb-6 border-2 border-[color:color-mix(in_oklch,var(--destructive)_40%,var(--border))]" data-testid="quality-alerts">
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="size-5 text-destructive" aria-hidden />Open alerts</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {q.alerts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                  <Badge variant="destructive">{KIND[a.kind]}</Badge>
                  <span className="min-w-0 flex-1 basis-56 break-words">{a.label}</span>
                  <span className="tabular-nums">{a.kind === "SUPPLIER_RATE" || a.kind === "PRODUCT_RATE" ? `${a.value.toFixed(1)}% (≥ ${a.threshold}%)` : `${a.value} claims (≥ ${a.threshold})`}</span>
                  {a.kind === "LOT" && <Link href="/admin/inventory/recalls" className="text-primary hover:underline">Recall?</Link>}
                  {manage && <AcknowledgeAlert id={a.id} />}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={Activity} label={`Claims, ${days} days`} value={q.totals.claims} locale="en" tone="tone-blue" i={0} hint={`${q.totals.open} open`} />
        <Tile icon={BadgeCheck} label="Approved" value={q.totals.approved} locale="en" tone="tone-teal" i={1} hint={`${q.totals.rejected} rejected`} />
        <Tile icon={Gauge} label="Credited" value={q.totals.credited} fmt="money" locale="en" tone="tone-violet" i={2} />
        <Tile icon={AlarmClock} label="Decided within the SLA" value={q.totals.withinSla ?? undefined} fmt="percent" locale="en" tone="tone-orange" i={3} hint={q.totals.medianHours === null ? "nothing decided yet" : `median ${q.totals.medianHours} h`} />
      </div>
      <div className="mb-6 grid gap-6 xl:grid-cols-[1fr_1.6fr]">
        <Card>
          <CardHeader><CardTitle>What goes wrong</CardTitle><CardDescription>Claims by reason</CardDescription></CardHeader>
          <CardContent>
            <ul className="space-y-3" data-testid="claims-by-reason">
              {q.byReason.map((r, i) => (
                <li key={r.reason}>
                  <div className="mb-1 flex justify-between gap-2 text-sm"><span>{REASON[r.reason]}</span><span className="font-semibold tabular-nums">{r.count}</span></div>
                  <div className="h-2.5 rounded-full bg-muted"><div className="motion-grow-x h-2.5 rounded-full" style={{ width: `${(r.count / maxReason) * 100}%`, background: tones[i], ["--i" as string]: i } as CSSProperties} /></div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Suppliers</CardTitle><CardDescription>Upheld supplier-fault claims per delivered order</CardDescription></CardHeader>
          <CardContent>
            <Table data-testid="quality-suppliers">
              <THead><TR><TH>Supplier</TH><TH className="text-right">Delivered</TH><TH className="text-right">Claims</TH><TH className="text-right">Upheld</TH><TH className="text-right">Rate</TH><TH className="text-right">Credited</TH>{cold && <TH className="text-right">Cold-chain breaches</TH>}</TR></THead>
              <TBody>
                {q.suppliers.map((s) => (
                  <TR key={s.id}>
                    <TD className="break-words"><Link href={`/admin/orders/claims?status=ALL`} className="hover:underline">{s.name}</Link></TD>
                    <TD className="text-right tabular-nums">{s.delivered}</TD><TD className="text-right tabular-nums">{s.claims}</TD><TD className="text-right tabular-nums">{s.upheld}</TD>
                    <TD className="text-right tabular-nums">{s.rate !== null && s.rate * 100 >= q.settings.supplierRatePct ? <Badge variant="destructive">{pct(s.rate)}</Badge> : pct(s.rate)}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(s.credited, "pt-PT")}</TD>
                    {cold && <TD className="text-right tabular-nums" data-testid="cold-breaches">{cold.bySeller.get(s.id) ?? 0}</TD>}
                  </TR>
                ))}
                {!q.suppliers.length && <EmptyRow colSpan={6}>No data.</EmptyRow>}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Products</CardTitle><CardDescription>Claimed units per delivered unit</CardDescription></CardHeader>
          <CardContent>
            <Table data-testid="quality-products">
              <THead><TR><TH>Product</TH><TH>Supplier</TH><TH className="text-right">Claims</TH><TH className="text-right">Claimed</TH><TH className="text-right">Delivered</TH><TH className="text-right">Rate</TH></TR></THead>
              <TBody>
                {q.products.map((p) => <TR key={p.offerId}><TD className="break-words">{p.product}</TD><TD>{p.seller}</TD><TD className="text-right tabular-nums">{p.claims}</TD><TD className="text-right tabular-nums">{p.claimed}</TD><TD className="text-right tabular-nums">{p.units}</TD><TD className="text-right tabular-nums">{pct(p.rate)}</TD></TR>)}
                {!q.products.length && <EmptyRow colSpan={6}>No claims.</EmptyRow>}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Lots</CardTitle><CardDescription>Several claims on one lot: think recall</CardDescription></CardHeader>
            <CardContent>
              <ul className="divide-y text-sm" data-testid="quality-lots">
                {q.lots.map((l) => <li key={`${l.offerId}-${l.lotCode}`} className="flex flex-wrap items-center gap-2 py-2"><span className="font-mono text-xs">{l.lotCode}</span><span className="min-w-0 flex-1 break-words">{l.product} · {l.seller}</span><Badge variant={l.claims >= q.settings.lotClaims ? "destructive" : "secondary"}>{l.claims}</Badge></li>)}
                {!q.lots.length && <li className="py-2 text-muted-foreground">No lot named in a claim.</li>}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>FIRINGI drivers</CardTitle><CardDescription>Upheld driver-fault claims and charge-backs</CardDescription></CardHeader>
            <CardContent>
              <ul className="divide-y text-sm" data-testid="quality-drivers">
                {q.drivers.map((d) => <li key={d.id} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1 break-words">{d.name}</span><span className="text-muted-foreground">{d.delivered} delivered</span><Badge variant={d.claims >= q.settings.driverClaims ? "destructive" : "secondary"}>{d.claims} claims</Badge>{d.charged > 0 && <span className="tabular-nums text-destructive">−{formatMoney(d.charged, "pt-PT")}</span>}{cold && (cold.byDriver.get(d.id) ?? 0) > 0 && <Badge variant="warning">{cold.byDriver.get(d.id)} cold-chain</Badge>}</li>)}
                {!q.drivers.length && <li className="py-2 text-muted-foreground">No data.</li>}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
