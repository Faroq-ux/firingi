import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { periodFrom } from "@/server/services/route-stats";
import { salesPerformance } from "@/server/services/crm-insights";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { PeriodForm } from "@/components/routes/period-form";
import { eur } from "@/components/crm/views";

export const metadata = { title: "Sales Performance" };

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.crm.view", "admin.crm.manage"]);
  const p = periodFrom(await searchParams);
  const rows = await salesPerformance(ctx, p);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Sales Performance" description="Per team member in the period: new and converted leads, deals won, contacts made, tasks done — and what their accounts bought." />
      <PeriodForm from={d(p.from)} to={d(p.to)} />
      <Card><CardContent className="pt-5">
        <Table data-testid="sales-performance">
          <THead><TR><TH>Team member</TH><TH className="text-right">New leads</TH><TH className="text-right">Converted</TH><TH className="text-right">Deals won</TH><TH className="text-right">Won / month</TH><TH className="text-right">Open pipeline</TH><TH className="text-right">Contacts made</TH><TH className="text-right">Tasks done</TH><TH className="text-right">Overdue</TH><TH className="text-right">Accounts</TH><TH className="text-right">Accounts bought</TH></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="font-medium">{r.name}</TD>
                <TD className="text-right tabular-nums">{r.leadsNew}</TD>
                <TD className="text-right tabular-nums">{r.leadsConverted}</TD>
                <TD className="text-right tabular-nums">{r.dealsWon}</TD>
                <TD className="text-right tabular-nums">{eur(r.wonValue)}</TD>
                <TD className="text-right tabular-nums">{eur(r.pipelineValue)}</TD>
                <TD className="text-right tabular-nums">{r.activities}</TD>
                <TD className="text-right tabular-nums">{r.tasksDone}</TD>
                <TD className={`text-right tabular-nums ${r.tasksOverdue ? "text-destructive" : ""}`}>{r.tasksOverdue}</TD>
                <TD className="text-right tabular-nums">{r.accounts}</TD>
                <TD className="text-right tabular-nums">{eur(r.accountRevenue)}<div className="text-xs text-muted-foreground">{r.accountOrders} orders</div></TD>
              </TR>
            ))}
            {!rows.length && <EmptyRow colSpan={11}>No sales activity in this period.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
