import Link from "next/link";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { ACTIVITY_STATUSES, customerActivity } from "@/server/services/crm-insights";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ActivityBadge, Pills, eur, pretty, when } from "@/components/crm/views";

export const metadata = { title: "Customer Activity" };
const HINT: Record<string, string> = { ACTIVE: "ordering as usual", NEW: "first order < 30 days", AT_RISK: "late vs their usual rhythm", DORMANT: "no order > 90 days", NEVER_ORDERED: "approved, no order yet" };

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string; type?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.customers.view", "admin.crm.view", "admin.crm.manage"]);
  const sp = await searchParams;
  const all = await customerActivity(ctx);
  const typed = sp.type === "WHOLESALER" || sp.type === "CUSTOMER" ? all.filter((r) => r.type === sp.type) : all;
  const status = (ACTIVITY_STATUSES as readonly string[]).includes(sp.status ?? "") || sp.status === "ALL" ? sp.status! : "AT_RISK";
  const rows = (status === "ALL" ? typed : typed.filter((r) => r.status === status)).sort((a, b) => b.spendPrev90 + b.spend90 - (a.spendPrev90 + a.spend90));
  return (
    <>
      <PageHeader title="Customer Activity" description="Who is buying and who is slipping away. A buyer is “at risk” when it hasn't ordered for twice its usual gap between orders (at least 30 days). Call them before they go." />
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="activity-tiles">
        {ACTIVITY_STATUSES.map((s) => (
          <Link key={s} href={`?status=${s}${sp.type ? `&type=${sp.type}` : ""}`} className={`rounded-lg border bg-card p-3 hover:shadow-sm ${status === s ? "ring-2 ring-primary" : ""}`}>
            <div className="text-xs text-muted-foreground">{pretty(s)}</div>
            <div className="text-2xl font-semibold tabular-nums">{typed.filter((r) => r.status === s).length}</div>
            <div className="text-xs text-muted-foreground">{HINT[s]}</div>
          </Link>
        ))}
      </div>
      <div className="mb-3"><Pills items={[{ value: "", label: "All buyers" }, { value: "CUSTOMER", label: "Customers" }, { value: "WHOLESALER", label: "Wholesalers (buying)" }]} current={sp.type ?? ""} param="type" base={{ status }} /></div>
      <Card><CardContent className="pt-5">
        <Table data-testid="activity-table">
          <THead><TR><TH>Buyer</TH><TH>Status</TH><TH>Last order</TH><TH className="text-right">Usual gap</TH><TH className="text-right">Orders 30 / 90 d</TH><TH className="text-right">Spend 90 d</TH><TH className="text-right">Previous 90 d</TH><TH>Last sign-in</TH><TH>Manager</TH></TR></THead>
          <TBody>
            {rows.map((r) => {
              const trend = r.spendPrev90 > 0 ? (r.spend90 - r.spendPrev90) / r.spendPrev90 : null;
              return (
                <TR key={r.id}>
                  <TD><Link className="font-medium text-primary hover:underline" href={`/admin/crm/accounts/${r.id}`}>{r.legalName}</Link><div className="text-xs text-muted-foreground">{r.flag} {pretty(r.type)}</div></TD>
                  <TD><ActivityBadge status={r.status} /></TD>
                  <TD>{when(r.lastOrderAt)}{r.daysSince !== null && <div className="text-xs text-muted-foreground">{r.daysSince} days ago</div>}</TD>
                  <TD className="text-right tabular-nums">{r.avgGapDays === null ? "—" : `${r.avgGapDays} d`}</TD>
                  <TD className="text-right tabular-nums">{r.orders30} / {r.orders90}</TD>
                  <TD className="text-right tabular-nums">{eur(r.spend90)}{trend !== null && <div className={`text-xs ${trend < 0 ? "text-destructive" : "text-success"}`}>{trend > 0 ? "▲" : "▼"} {Math.abs(Math.round(trend * 100))}%</div>}</TD>
                  <TD className="text-right tabular-nums">{eur(r.spendPrev90)}</TD>
                  <TD className="text-xs">{when(r.lastLoginAt)}</TD>
                  <TD>{r.owner ?? "—"}</TD>
                </TR>
              );
            })}
            {!rows.length && <EmptyRow colSpan={9}>Nobody here.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
