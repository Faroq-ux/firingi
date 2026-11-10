import Link from "next/link";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { splitOrders } from "@/server/services/orders";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Order Split" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage"]);
  const { checkouts, moved } = await splitOrders(ctx);
  const ref = (o: { id: string; number: string; seller: { legalName: string }; status: string; grandTotal: { toString(): string } }) => (
    <li key={o.id} className="flex flex-wrap items-center gap-2">
      <Link className="font-medium text-primary hover:underline" href={`/admin/orders/${o.id}`}>{o.number}</Link>
      <span>{o.seller.legalName}</span><Badge variant="secondary">{o.status.toLowerCase().replace(/_/g, " ")}</Badge>
      <span className="tabular-nums text-muted-foreground">{formatMoney(o.grandTotal.toString(), "en")}</span>
    </li>
  );
  return (
    <>
      <PageHeader title="Order Split / Multi-Vendor Orders" description="One checkout, several orders: a customer's cart with products from several suppliers becomes one order per supplier (each with its own delivery); in 'order from FIRINGI' countries FIRINGI may split a cart across wholesalers. Below: orders FIRINGI moved on to another supplier. Last 90 days." />
      <Card className="mb-4">
        <CardHeader><CardTitle>Checkouts split into several orders ({checkouts.length})</CardTitle></CardHeader>
        <CardContent>
          <Table data-testid="split-checkouts">
            <THead><TR><TH>Customer</TH><TH>Placed</TH><TH>How</TH><TH>Orders</TH><TH className="text-right">Total</TH></TR></THead>
            <TBody>
              {checkouts.map((c) => (
                <TR key={c.checkoutId}>
                  <TD>{c.buyer}</TD><TD className="text-xs">{c.placedAt ? formatDate(c.placedAt, "en-GB", true) : ""}</TD>
                  <TD className="text-xs">{c.routed ? "FIRINGI picked the suppliers" : "customer's cart, one order per supplier"}</TD>
                  <TD className="text-sm"><ul className="space-y-1">{c.orders.map(ref)}</ul></TD>
                  <TD className="text-right tabular-nums">{formatMoney(c.total, "en")}</TD>
                </TR>
              ))}
              {!checkouts.length && <EmptyRow colSpan={5}>No split checkouts in the last 90 days.</EmptyRow>}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Orders moved to other suppliers ({moved.length})</CardTitle></CardHeader>
        <CardContent>
          <Table data-testid="moved-orders">
            <THead><TR><TH>Original order</TH><TH>Customer</TH><TH>Now with</TH></TR></THead>
            <TBody>
              {moved.map((o) => <TR key={o.id}><TD className="text-sm"><ul>{ref(o)}</ul></TD><TD>{o.buyer.legalName}</TD><TD className="text-sm"><ul className="space-y-1">{o.childOrders.map(ref)}</ul></TD></TR>)}
              {!moved.length && <EmptyRow colSpan={3}>No moved orders in the last 90 days.</EmptyRow>}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
