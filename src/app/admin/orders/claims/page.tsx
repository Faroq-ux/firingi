import Link from "next/link";
import { AlarmClock, BadgeCheck, Euro, Inbox, ShieldAlert } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listClaims, qualityOverview } from "@/server/claims/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tile } from "@/components/motion/dashboard-kit";
import { CLAIM_STATUS_TONE, SlaChip } from "@/components/claims/views";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Quality Claims" };
const FILTERS = ["OPEN", "OVERDUE", "APPROVED", "REJECTED", "WITHDRAWN"] as const;
const REASON: Record<string, string> = { DAMAGED: "Damaged", MISSING: "Missing", WRONG_PRODUCT: "Wrong product", TEMPERATURE: "Temperature", SHORT_DATED: "Short-dated", QUALITY: "Quality" };
const tEn = (k: string, v?: Record<string, string | number>) => (k === "sla.late" ? `${v?.hours} h late` : k === "sla.left" ? `${v?.hours} h left` : k);
const eur = (v: number) => formatMoney(v, "pt-PT");

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.claims.manage", "admin.orders.view", "admin.orders.manage"]);
  const sp = await searchParams;
  const status = FILTERS.find((x) => x === sp.status) ?? (sp.status === "ALL" ? undefined : "OPEN");
  const [rows, ov] = await Promise.all([listClaims(ctx, "ADMIN", status ? { status } : {}), qualityOverview(ctx, 30)]);
  const overdue = (await listClaims(ctx, "ADMIN", { status: "OVERDUE" })).length;
  return (
    <>
      <PageHeader title="Quality Claims" description="Customers report damaged, missing, wrong, warm, short-dated or poor-quality goods with photos. The supplier gives its side; FIRINGI decides within the SLA — credit note, replacement or rejection — and who was at fault. Supplier faults are charged back on the supplier's statement; a FIRINGI driver only on fee-paid deliveries, capped at the driver's pay." icon={ShieldAlert} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={Inbox} label="Open" value={ov.totals.open} locale="en" tone="tone-orange" i={0} href="?status=OPEN" testId="kpi-open" />
        <Tile icon={AlarmClock} label="Past the SLA" value={overdue} locale="en" tone="tone-pink" i={1} href="?status=OVERDUE" testId="kpi-overdue" hint={ov.totals.withinSla === null ? undefined : `${Math.round(ov.totals.withinSla * 100)}% decided in time (30 d)`} />
        <Tile icon={BadgeCheck} label="Approved, 30 days" value={ov.totals.approved} locale="en" tone="tone-teal" i={2} hint={ov.totals.medianHours === null ? undefined : `median ${ov.totals.medianHours} h to decide`} />
        <Tile icon={Euro} label="Credited, 30 days" value={ov.totals.credited} fmt="money" locale="en" tone="tone-violet" i={3} />
      </div>
      <div className="mb-3 flex flex-wrap gap-3 text-sm">
        {FILTERS.map((x) => <Link key={x} href={`?status=${x}`} className={status === x ? "font-semibold" : "text-muted-foreground hover:underline"}>{x === "OVERDUE" ? "Past the SLA" : x.charAt(0) + x.slice(1).toLowerCase()}</Link>)}
        <Link href="?status=ALL" className={!status ? "font-semibold" : "text-muted-foreground hover:underline"}>All</Link>
        <span className="ml-auto flex gap-3"><Link href="/admin/orders/claims/chargebacks" className="font-medium text-primary hover:underline">Charge-backs</Link><Link href="/admin/orders/claims/quality" className="font-medium text-primary hover:underline">Quality & alerts</Link></span>
      </div>
      <Card><CardContent className="pt-5">
        <Table data-testid="admin-claims">
          <THead><TR><TH>Claim</TH><TH>Order</TH><TH>Customer → Supplier</TH><TH>Reason</TH><TH>Products</TH><TH>Status</TH><TH>Supplier</TH><TH className="text-right">Credit</TH><TH>SLA</TH></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id} className={r.overdue ? "bg-[color-mix(in_oklch,var(--destructive)_6%,transparent)]" : undefined}>
                <TD><Link href={`/admin/orders/claims/${r.id}`} className="font-medium text-primary hover:underline">{r.number}</Link></TD>
                <TD><Link href={`/admin/orders/${r.orderId}`} className="hover:underline">{r.orderNumber}</Link></TD>
                <TD className="break-words">{r.buyer}<div className="text-xs text-muted-foreground">{r.seller}</div></TD>
                <TD>{REASON[r.reason]}</TD>
                <TD className="max-w-56 break-words">{r.products}<div className="text-xs text-muted-foreground">{r.units} units · wants {r.preferredOutcome.toLowerCase()}</div></TD>
                <TD><Badge variant={CLAIM_STATUS_TONE[r.status]}>{r.status.toLowerCase()}</Badge>{r.fault && <div className="mt-1 text-xs text-muted-foreground">{r.fault.toLowerCase()} fault</div>}</TD>
                <TD className="text-xs">{r.supplierResponse ? r.supplierResponse.toLowerCase() : r.status === "OPEN" ? <span className="text-muted-foreground">waiting</span> : "—"}</TD>
                <TD className="text-right tabular-nums">{r.credit !== null ? eur(r.credit) : "—"}</TD>
                <TD>{r.status === "OPEN" ? <SlaChip due={r.dueBy} t={tEn} /> : "—"}</TD>
              </TR>
            ))}
            {!rows.length && <EmptyRow colSpan={9}>No claims here.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
