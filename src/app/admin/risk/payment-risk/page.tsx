import Link from "next/link";
import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { paymentPolicy, paymentRisk } from "@/server/services/payments";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CustomerTermsForm } from "@/components/finance/controls";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Payment Risk" };
const STATUS = {
  BLOCKED_OVERDUE: ["destructive", "Blocked — overdue"], AT_LIMIT: ["destructive", "At credit limit"], NEAR_LIMIT: ["warning", "Near limit"], OVERDUE: ["warning", "Overdue"], OK: ["success", "OK"],
} as const;

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage", "admin.risk.view"]);
  const [rows, policy] = await Promise.all([paymentRisk(ctx), paymentPolicy()]);
  const edit = can(ctx, "admin.customers.manage");
  const total = (k: "exposure" | "overdue") => rows.reduce((a, r) => a + r[k], 0);
  return (
    <>
      <PageHeader title="Payment Risk" description={`Exposure = unpaid invoices + orders not yet invoiced. ${policy.overdueBlockDays !== null ? `Buyers with an invoice overdue more than ${policy.overdueBlockDays} days can't order.` : "Overdue invoices don't block orders."} ${policy.creditCheck ? "Credit limits are enforced at checkout." : "Credit limits are not enforced."}`} />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4"><div className="text-xs uppercase text-muted-foreground">Total exposure</div><div className="text-2xl font-semibold tabular-nums">{formatMoney(total("exposure"))}</div></div>
        <div className="rounded-xl border bg-card p-4"><div className="text-xs uppercase text-muted-foreground">Overdue</div><div className="text-2xl font-semibold tabular-nums">{formatMoney(total("overdue"))}</div></div>
        <div className="rounded-xl border bg-card p-4" data-testid="risk-blocked"><div className="text-xs uppercase text-muted-foreground">Buyers blocked</div><div className="text-2xl font-semibold tabular-nums">{rows.filter((r) => r.status === "BLOCKED_OVERDUE" || r.status === "AT_LIMIT").length}</div></div>
      </div>
      <Table>
        <THead><TR><TH>Buyer</TH><TH>Status</TH><TH className="text-right">Unpaid invoices</TH><TH className="text-right">Overdue</TH><TH className="text-right">Open orders</TH><TH className="text-right">Exposure</TH><TH>Terms · credit limit</TH></TR></THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={7}>No buyers.</EmptyRow>}
          {rows.map((r) => (
            <TR key={r.id} data-testid="risk-row">
              <TD><Link className="font-medium text-primary hover:underline" href={`/admin/companies/${r.id}`}>{r.name}</Link><div className="text-xs text-muted-foreground">{r.type.toLowerCase()} · {r.country}</div></TD>
              <TD><Badge variant={STATUS[r.status][0]}>{STATUS[r.status][1]}</Badge>{r.usage !== null && Number.isFinite(r.usage) && <div className="text-xs text-muted-foreground">{Math.round(r.usage * 100)}% of limit used</div>}</TD>
              <TD className="text-right tabular-nums">{formatMoney(r.openInvoices)}<div className="text-xs text-muted-foreground">{r.invoiceCount} invoice(s)</div></TD>
              <TD className="text-right tabular-nums">{r.overdue ? formatMoney(r.overdue) : "—"}{r.oldestOverdueDays > 0 && <div className="text-xs text-destructive">{r.oldestOverdueDays} days</div>}</TD>
              <TD className="text-right tabular-nums">{formatMoney(r.openOrders)}<div className="text-xs text-muted-foreground">{r.openOrderCount} order(s)</div></TD>
              <TD className="text-right font-medium tabular-nums">{formatMoney(r.exposure)}{r.available !== null && <div className="text-xs text-muted-foreground">{formatMoney(Math.max(0, r.available))} available</div>}</TD>
              <TD>{edit ? <CustomerTermsForm companyId={r.id} days={r.termsDays} limit={r.limit === null ? null : String(r.limit)} /> : `${r.termsDays} d · ${r.limit === null ? "no limit" : formatMoney(r.limit)}`}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
