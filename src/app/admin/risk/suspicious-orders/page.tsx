import Link from "next/link";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listAssessments } from "@/server/risk/service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { HeldDecision, ReviewButtons } from "@/components/risk/forms";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Suspicious Orders" };

export default async function Page({ searchParams }: { searchParams: Promise<{ show?: string; order?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.risk.view", "admin.risk.manage"]);
  const sp = await searchParams;
  const show = sp.show === "all" ? "all" : "open";
  const rows = await listAssessments(ctx, show === "open" ? { review: "OPEN" } : {});
  const manage = can(ctx, "admin.risk.manage");
  return (
    <>
      <PageHeader title="Suspicious Orders" description="Orders FIRINGI's risk checks scored at checkout. Held orders (high risk) wait here: the supplier doesn't see them until you release them; cancelling tells the customer the reason. Flagged orders (medium) went through — mark them fine or fraud." />
      <div className="mb-4 flex gap-2 text-sm">{(["open", "all"] as const).map((s) => <Link key={s} href={`?show=${s}`} className={`rounded-md border px-3 py-1 ${s === show ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}>{s === "open" ? "To review" : "All"}</Link>)}</div>
      <Card>
        <CardContent className="pt-5">
          <Table data-testid="suspicious-orders">
            <THead><TR><TH>Order</TH><TH>Customer → supplier</TH><TH className="text-right">Total</TH><TH>Risk</TH><TH>Why</TH><TH>Review</TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id} className={r.orderId === sp.order ? "bg-[color-mix(in_oklch,var(--vivid-orange)_10%,transparent)]" : ""}>
                  <TD><Link className="font-medium text-primary hover:underline" href={`/admin/orders/${r.order.id}`}>{r.order.number}</Link><div className="text-xs text-muted-foreground">{formatDate(r.order.placedAt, "en-GB", true)} · {r.order.status.toLowerCase().replace(/_/g, " ")}</div></TD>
                  <TD className="text-xs">{r.order.buyer.legalName}<div className="text-muted-foreground">→ {r.order.seller.legalName}</div></TD>
                  <TD className="text-right tabular-nums">{formatMoney(r.order.grandTotal.toString(), "en")}</TD>
                  <TD><Badge variant={r.level === "HIGH" ? "destructive" : "warning"}>{r.level.toLowerCase()} · {r.score}</Badge>{r.held && <div className="mt-1 text-xs font-semibold text-destructive">held</div>}</TD>
                  <TD className="text-xs"><ul className="space-y-0.5">{(r.reasons as { rule: string; points: number; detail: string }[]).map((x) => <li key={x.rule}>+{x.points} {x.detail}</li>)}</ul></TD>
                  <TD className="min-w-72 text-xs">
                    {r.review !== "OPEN" ? <><Badge variant={r.review === "FRAUD" ? "destructive" : "success"}>{r.review === "FRAUD" ? "fraud" : "fine"}</Badge>{r.note && <div className="mt-1">{r.note}</div>}</>
                      : manage ? (r.order.status === "ON_HOLD" ? <HeldDecision orderId={r.order.id} /> : <ReviewButtons id={r.id} />) : "open"}
                  </TD>
                </TR>
              ))}
              {!rows.length && <EmptyRow colSpan={6}>{show === "open" ? "Nothing to review." : "No risk checks yet."}</EmptyRow>}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
