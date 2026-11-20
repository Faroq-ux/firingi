import Link from "next/link";
import { CalendarClock, Settings } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminPayLater, termLabel } from "@/server/pay-later/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Pay Later" };
export const dynamic = "force-dynamic";

const tone = (s: string) => (s === "PAID" ? "success" : s === "OVERDUE" ? "destructive" : s === "CANCELLED" ? "secondary" : "warning") as "success" | "destructive" | "secondary" | "warning";

export default async function AdminPayLaterPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage", "admin.settings.manage"]);
  const d = await adminPayLater(ctx);
  const eur = (n: number) => formatMoney(n, "en");
  const o = d.overview;
  const tiles = [["Own credit outstanding", eur(o.ownOutstanding), "pl-t-own"], ["Own credit overdue", eur(o.ownOverdue), "pl-t-overdue"], ["Partner-financed volume", eur(o.partnerVolume), "pl-t-partner"], ["Fees paid by buyers", eur(o.buyerFees), "pl-t-buyer-fees"], ["Fees paid by FIRINGI", eur(o.firingiFees), "pl-t-firingi-fees"], ["Orders paid later", String(o.plans), "pl-t-plans"]] as const;
  return (
    <>
      <PageHeader title="Pay Later" icon={CalendarClock} description="Buyers pay an order's invoice in N days or monthly instalments — financed by the payment gateway's partner (it pays FIRINGI at once) or by FIRINGI's own credit."
        actions={<Link href="/admin/finance/pay-later/settings" className={buttonVariants({ variant: "outline" })} data-testid="pl-settings-link"><Settings className="size-4" /> Settings</Link>} />
      <p className="mb-4 text-sm text-muted-foreground">Partner: {d.partner ?? "none connected — only FIRINGI's own credit is offered"}</p>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        {tiles.map(([label, v, id]) => <Card key={id}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold tabular-nums" data-testid={id}>{v}</p></CardContent></Card>)}
      </div>
      <Card>
        <CardHeader><CardTitle>Orders paid later</CardTitle></CardHeader>
        <CardContent>
          {!d.plans.length ? <p className="py-6 text-center text-sm text-muted-foreground">Nothing yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="pl-admin-plans">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-normal">Order</th><th className="py-2 pr-3 font-normal">Business</th><th className="py-2 pr-3 font-normal">Term</th><th className="py-2 pr-3 font-normal">Financed by</th><th className="py-2 pr-3 font-normal">Status</th><th className="py-2 pr-3 text-right font-normal">Amount</th><th className="py-2 pr-3 text-right font-normal">Fees (buyer / FIRINGI)</th><th className="py-2 text-right font-normal">Still owed</th></tr></thead>
                <tbody>
                  {d.plans.map((p) => (
                    <tr key={p.id} className="border-t" data-testid="pl-admin-row">
                      <td className="py-2 pr-3"><Link href={`/admin/orders/${p.order.id}`} className="text-primary hover:underline">{p.order.number}</Link><div className="text-xs text-muted-foreground">{formatDate(p.createdAt, "en")}</div></td>
                      <td className="break-words py-2 pr-3">{p.company.name}</td>
                      <td className="whitespace-nowrap py-2 pr-3">{termLabel(p.term)}</td>
                      <td className="py-2 pr-3">{p.model === "PARTNER" ? "Partner" : "Own credit"}</td>
                      <td className="py-2 pr-3"><Badge variant={tone(p.status)}>{p.status.toLowerCase()}</Badge></td>
                      <td className="py-2 pr-3 text-right tabular-nums">{eur(p.amount)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{eur(p.buyerFee)} / {eur(p.firingiFee)}</td>
                      <td className="py-2 text-right tabular-nums">{p.model === "OWN" ? eur(p.unpaid) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
