import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { PayVendorInvoice } from "@/components/finance/fiscal-forms";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { duePayouts } from "@/server/services/payouts";

export const metadata = { title: "Supplier Payouts Due" };
const eur = (n: number) => new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(n);

export default async function Page({ searchParams }: { searchParams: Promise<{ within?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage"]);
  const within = [7, 14, 30].includes(Number((await searchParams).within)) ? Number((await searchParams).within) : 7;
  const d = await duePayouts(ctx, { withinDays: within });
  const canPay = can(ctx, "admin.finance.manage");
  const label = (n: number) => (n < 0 ? <Badge variant="destructive">{-n} d overdue</Badge> : n === 0 ? <Badge variant="warning">today</Badge> : <Badge variant={n <= 3 ? "warning" : "secondary"}>in {n} d</Badge>);
  return (
    <>
      <PageHeader title="Supplier Payouts Due" description="Approved supplier invoices with money still to pay, soonest first. Pay them by bank transfer, then record the payout here (big amounts need a second person). Finance gets a reminder each day something is due within 3 days."
        actions={<a className="text-sm font-medium text-primary underline-offset-4 hover:underline" href={`/api/admin/payouts-due?within=${within}`}>Download CSV</a>} />
      <div className="mb-3 flex gap-3 text-sm">{[7, 14, 30].map((n) => <Link key={n} href={`?within=${n}`} className={n === within ? "font-semibold" : "text-muted-foreground hover:underline"}>next {n} days</Link>)}</div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3" data-testid="payout-kpis">
        <Kpi label="Overdue" value={d.totals.overdue} fmt="money" locale="en" hint={`${d.overdue.length} invoices`} index={0} />
        <Kpi label={`Due in the next ${within} days`} value={d.totals.soon} fmt="money" locale="en" hint={`${d.soon.length} invoices`} index={1} />
        <Kpi label="Later" value={d.totals.later} fmt="money" locale="en" hint={`${d.later.length} invoices`} index={2} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardHeader><CardTitle>Invoices to pay</CardTitle></CardHeader><CardContent>
          <Table data-testid="payouts-due">
            <THead><TR><TH>Supplier</TH><TH>Invoice</TH><TH>Due</TH><TH className="text-right">Open</TH><TH /></TR></THead>
            <TBody>
              {[...d.overdue, ...d.soon].map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium">{r.vendor}<div className="text-xs font-normal text-muted-foreground">{r.vendorType.toLowerCase()}</div></TD>
                  <TD className="font-mono text-xs">{r.number}<div className="text-muted-foreground">{r.issueDate}</div></TD>
                  <TD className="text-xs">{r.dueDate} {label(r.daysLeft)}</TD>
                  <TD className="text-right font-semibold tabular-nums">{eur(r.open)}</TD>
                  <TD>{canPay && <PayVendorInvoice vendorInvoiceId={r.id} vendorId={r.vendorId} amount={r.open} />}</TD>
                </TR>
              ))}
              {!d.overdue.length && !d.soon.length && <EmptyRow colSpan={5}>Nothing due in the next {within} days.</EmptyRow>}
            </TBody>
          </Table>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>By supplier</CardTitle></CardHeader><CardContent>
          <Table data-testid="payouts-by-supplier">
            <THead><TR><TH>Supplier</TH><TH className="text-right">To pay</TH></TR></THead>
            <TBody>
              {d.bySupplier.map((g) => <TR key={g.vendorId}><TD>{g.vendor}<div className="text-xs text-muted-foreground">{g.count} invoice{g.count > 1 ? "s" : ""} · next {g.nextDue}</div></TD><TD className="text-right tabular-nums">{eur(g.open)}{g.overdue > 0 && <div className="text-xs text-destructive">{eur(g.overdue)} overdue</div>}</TD></TR>)}
              {!d.bySupplier.length && <EmptyRow colSpan={2}>—</EmptyRow>}
            </TBody>
          </Table>
        </CardContent></Card>
      </div>
    </>
  );
}
