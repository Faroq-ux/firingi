/** Contract & customer prices given by suppliers (admin). */
import Link from "next/link";
import type { Ctx } from "@/server/context";
import { contractPricing } from "@/server/services/performance";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { Pills, pretty } from "@/components/crm/views";
import { formatDate } from "@/lib/utils";

const ST: Record<string, "success" | "warning" | "secondary" | "default"> = { ACTIVE: "success", EXPIRING: "warning", EXPIRED: "secondary", FUTURE: "default" };

export async function ContractsView({ ctx, vendorType, status, title }: { ctx: Ctx; vendorType?: "DISTRIBUTOR" | "WHOLESALER"; status: string; title: string }) {
  const all = await contractPricing(ctx, { vendorType });
  const rows = status === "ALL" ? all : all.filter((r) => r.status === status);
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)} %`);
  return (
    <>
      <PageHeader title={title} description="Special prices suppliers give individual customers (contracts), single customers and customer groups — with the discount against the supplier's normal price. Suppliers manage them in their portal; contracts ending within 30 days are flagged." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Active" value={all.filter((r) => r.status === "ACTIVE").length} fmt="number" locale="pt-PT" tone="tone-teal" index={0} />
        <Kpi label="Ending within 30 days" value={all.filter((r) => r.status === "EXPIRING").length} fmt="number" locale="pt-PT" tone="tone-orange" index={1} />
        <Kpi label="Expired" value={all.filter((r) => r.status === "EXPIRED").length} fmt="number" locale="pt-PT" tone="tone-pink" index={2} />
        <Kpi label="Average discount" value={(() => { const d = all.filter((r) => r.avgDiscount !== null); return d.length ? d.reduce((a, r) => a + (r.avgDiscount ?? 0), 0) / d.length : NaN; })()} fmt="percent" locale="pt-PT" tone="tone-violet" index={3} />
      </div>
      <div className="mb-3"><Pills items={[{ value: "ALL", label: "All" }, { value: "ACTIVE", label: "Active" }, { value: "EXPIRING", label: "Ending soon" }, { value: "EXPIRED", label: "Expired" }]} current={status} param="status" base={{}} /></div>
      <Card><CardContent className="pt-5">
        <Table data-testid="contracts-table">
          <THead><TR><TH>Price list</TH><TH>Supplier</TH><TH>For</TH><TH>Kind</TH><TH className="text-right">Products</TH><TH className="text-right">Avg discount</TH><TH className="text-right">Max discount</TH><TH>Valid</TH><TH>Status</TH></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="font-medium">{r.name}</TD>
                <TD>{r.vendor.legalName}</TD>
                <TD>{r.targetId ? <Link className="text-primary hover:underline" href={`/admin/crm/accounts/${r.targetId}`}>{r.target}</Link> : r.target}</TD>
                <TD>{pretty(r.scope)}</TD>
                <TD className="text-right tabular-nums">{r.items}</TD>
                <TD className="text-right tabular-nums">{pct(r.avgDiscount)}</TD>
                <TD className="text-right tabular-nums">{pct(r.maxDiscount)}</TD>
                <TD className="text-xs">{formatDate(r.validFrom, "en-GB")} → {r.validTo ? formatDate(r.validTo, "en-GB") : "open"}</TD>
                <TD><Badge variant={ST[r.status]}>{pretty(r.status)}</Badge></TD>
              </TR>
            ))}
            {!rows.length && <EmptyRow colSpan={9}>No price lists here.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
