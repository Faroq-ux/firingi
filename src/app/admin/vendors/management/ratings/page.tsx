import Link from "next/link";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listRatings, ratingSummary } from "@/server/services/performance";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ModerateRating } from "@/components/profit/forms";
import { Pills } from "@/components/crm/views";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Ratings" };
const stars = (n: number | null) => (n === null ? "—" : `${"★".repeat(Math.round(n))}${"☆".repeat(5 - Math.round(n))}`);

export default async function Page({ searchParams }: { searchParams: Promise<{ low?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.customers.view"]);
  const low = (await searchParams).low === "1";
  const [rows, summary] = await Promise.all([listRatings(ctx, { maxStars: low ? 3 : undefined }), ratingSummary()]);
  const names = new Map(rows.map((r) => [r.order.seller.id, r.order.seller.legalName]));
  const top = [...summary.entries()].map(([id, s]) => ({ id, name: names.get(id) ?? id, ...s })).sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0));
  const moderate = can(ctx, ["admin.vendors.approve", "admin.customers.manage"]);
  return (
    <>
      <PageHeader title="Ratings" description="Customers rate delivered orders (the order and the delivery, 1–5 stars). Suppliers see and can answer the ratings of their orders; FIRINGI can hide a rating that breaks the rules." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="tile gloss tone-orange">
          <CardHeader><CardTitle>Average per supplier</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm" data-testid="rating-summary">
            {top.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{s.name}</span>
                <span className="whitespace-nowrap"><span className="text-[color:var(--vivid-orange)]">{stars(s.avg)}</span> <b className="tabular-nums">{s.avg?.toFixed(1)}</b> <span className="text-xs text-muted-foreground">({s.count})</span></span>
              </div>
            ))}
            {!top.length && <p className="text-muted-foreground">No ratings yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Ratings</CardTitle><Pills items={[{ value: "", label: "All" }, { value: "1", label: "3 stars or less" }]} current={low ? "1" : ""} param="low" base={{}} /></CardHeader>
          <CardContent>
            <Table data-testid="ratings-table">
              <THead><TR><TH>Order</TH><TH>Customer</TH><TH>Supplier</TH><TH>Order</TH><TH>Delivery</TH><TH>Comment</TH><TH>Date</TH>{moderate && <TH />}</TR></THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id} className={r.hidden ? "opacity-50" : ""}>
                    <TD><Link className="text-primary hover:underline" href={`/admin/orders/${r.order.id}`}>{r.order.number}</Link></TD>
                    <TD>{r.order.buyer.tradeName ?? r.order.buyer.legalName}</TD>
                    <TD>{r.order.seller.legalName}{r.order.routedByFiringi && <span className="text-xs text-muted-foreground"> (via FIRINGI)</span>}</TD>
                    <TD className="whitespace-nowrap text-[color:var(--vivid-orange)]">{stars(r.stars)}</TD>
                    <TD className="whitespace-nowrap text-[color:var(--vivid-orange)]">{stars(r.deliveryStars)}</TD>
                    <TD className="max-w-80">{r.comment ?? ""}{r.reply && <div className="mt-1 text-xs text-muted-foreground">↳ {r.reply}</div>}{r.hidden && <Badge variant="secondary" className="ml-1">hidden</Badge>}</TD>
                    <TD className="text-xs">{formatDate(r.createdAt, "en-GB")}</TD>
                    {moderate && <TD><ModerateRating id={r.id} hidden={r.hidden} /></TD>}
                  </TR>
                ))}
                {!rows.length && <EmptyRow colSpan={moderate ? 8 : 7}>No ratings.</EmptyRow>}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
