import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { listAssessments, riskOverview } from "@/server/risk/service";
import { Level, NoAccess, aiPage, eur } from "../_kit";

export const metadata = { title: "Fraud/Risk Alerts" };

export default async function Page() {
  const { ctx, allowed } = await aiPage(["admin.risk.view", "admin.risk.manage"]);
  const header = <PageHeader title="Fraud/Risk Alerts" description="Checkouts FIRINGI's risk checks scored and that still wait for a person: held orders first, then flagged ones. Decide them on Suspicious Orders." actions={<Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href="/admin/risk/suspicious-orders">Suspicious Orders →</Link>} />;
  if (!allowed) return <>{header}<NoAccess what="risk checks" /></>;
  const [open, o] = await Promise.all([listAssessments(ctx, { review: "OPEN" }), riskOverview(ctx, 30)]);
  const rows = [...open].sort((a, b) => Number(b.held) - Number(a.held) || b.score - a.score);
  return (
    <>
      {header}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="fraud-kpis">
        <Kpi label="Waiting for review" value={rows.length} fmt="number" locale="en" index={0} />
        <Kpi label="Held now" value={rows.filter((r) => r.held && r.order.status === "ON_HOLD").length} fmt="number" locale="en" index={1} />
        <Kpi label="Held, 30 days" value={o.held} fmt="number" locale="en" hint={`worth ${eur(o.heldValue)}`} index={2} />
        <Kpi label="Confirmed fraud, 30 days" value={o.fraud} fmt="number" locale="en" index={3} />
      </div>
      <Card><CardContent className="pt-4">
        <Table data-testid="fraud-table">
          <THead><TR><TH>Order</TH><TH>Customer</TH><TH>Reasons</TH><TH className="text-right">Score</TH><TH /></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD><Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/admin/orders/${r.orderId}`}>{r.order.number}</Link></TD>
                <TD>{r.order.buyer.legalName}</TD>
                <TD className="text-sm">{(r.reasons as { detail: string }[]).map((x) => x.detail).join("; ")}</TD>
                <TD className="text-right font-semibold tabular-nums">{r.score}</TD>
                <TD><Level value={r.level}>{r.held ? "held" : r.level.toLowerCase()}</Level></TD>
              </TR>
            ))}
            {!rows.length && <EmptyRow colSpan={5}>No risk alerts waiting.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
