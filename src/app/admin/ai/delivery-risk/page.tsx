import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { deliveryRisk } from "@/server/ai/insights";
import { reasonText } from "@/lib/ai";
import { Level, NoAccess, SuggestOnly, aiPage } from "../_kit";

export const metadata = { title: "Delivery Risk Detection" };

export default async function Page() {
  const { ctx, allowed } = await aiPage(["admin.orders.view", "admin.delivery.view"]);
  const header = <PageHeader title="Delivery Risk Detection" description="Open orders likely to arrive late or short: not confirmed in time, requested day close or passed, less stock than ordered, a driver ETA after the requested day, or a supplier that often declines. Points add up to the risk." />;
  if (!allowed) return <>{header}<NoAccess what="open orders" /></>;
  const rows = await deliveryRisk(ctx, "STAFF");
  return (
    <>
      {header}
      <SuggestOnly />
      <div className="mb-4 grid gap-3 sm:grid-cols-3" data-testid="delivery-kpis">
        <Kpi label="High risk" value={rows.filter((r) => r.level === "HIGH").length} fmt="number" locale="en" index={0} />
        <Kpi label="Medium risk" value={rows.filter((r) => r.level === "MEDIUM").length} fmt="number" locale="en" index={1} />
        <Kpi label="Low risk" value={rows.filter((r) => r.level === "LOW").length} fmt="number" locale="en" index={2} />
      </div>
      <Card><CardContent className="pt-4">
        <Table data-testid="delivery-table">
          <THead><TR><TH>Order</TH><TH>Supplier → customer</TH><TH>Status</TH><TH>Requested</TH><TH>Why</TH><TH className="text-right">Score</TH><TH /></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.orderId}>
                <TD><Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/admin/orders/${r.orderId}`}>{r.number}</Link></TD>
                <TD>{r.seller} → {r.buyer}</TD>
                <TD className="text-xs">{r.status.replaceAll("_", " ").toLowerCase()}</TD>
                <TD className="tabular-nums">{r.requested ?? "—"}</TD>
                <TD className="text-sm"><ul className="list-disc pl-4">{r.reasons.map((x) => <li key={x.code}>{reasonText(x)}</li>)}</ul></TD>
                <TD className="text-right font-semibold tabular-nums">{r.score}</TD>
                <TD><Level value={r.level} /></TD>
              </TR>
            ))}
            {!rows.length && <EmptyRow colSpan={7}>No open order looks at risk.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
