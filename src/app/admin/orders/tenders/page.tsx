import Link from "next/link";
import { Gavel, Settings } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminTenders } from "@/server/tenders/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ReviewTender } from "@/components/pay-later/admin";
import { statusTone } from "@/components/tenders/labels";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Tenders" };
export const dynamic = "force-dynamic";

export default async function AdminTendersPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage", "admin.settings.manage"]);
  const d = await adminTenders(ctx);
  const canManage = ctx.permissions.has("admin.orders.manage") || ctx.permissions.has("admin.settings.manage");
  const o = d.overview;
  const tiles = [["Waiting for FIRINGI", o.pending, "td-t-pending"], ["Open for bids", o.open, "td-t-open"], ["Closed, to award", o.closed, "td-t-closed"], ["Awarded", o.awarded, "td-t-awarded"], ["Orders from tenders", o.orders, "td-t-orders"], ["Awarded value (net)", formatMoney(o.awardedNet, "en"), "td-t-value"]] as const;
  const pending = d.tenders.filter((t) => t.status === "PENDING");
  return (
    <>
      <PageHeader title="Tenders" icon={Gavel} description="Buyers post what they need; suppliers send sealed bids per line; the buyer awards each line and each supplier's lines become an order. FIRINGI invoices the buyer as usual; commission comes off the supplier's side."
        actions={canManage ? <Link href="/admin/orders/tenders/settings" className={buttonVariants({ variant: "outline" })} data-testid="td-settings-link"><Settings className="size-4" /> Settings</Link> : null} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        {tiles.map(([label, v, id]) => <Card key={id}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold tabular-nums" data-testid={id}>{v}</p></CardContent></Card>)}
      </div>
      {pending.length > 0 && (
        <Card className="mb-6" data-testid="td-pending">
          <CardHeader><CardTitle>Waiting for FIRINGI</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y">{pending.map((t) => <li key={t.id} className="space-y-2 py-3 text-sm" data-testid="td-pending-row"><p className="break-words"><Link href={`/admin/orders/tenders/${t.id}`} className="font-medium text-primary hover:underline">{t.number} · {t.title}</Link> <span className="text-xs text-muted-foreground">· {t.buyer} · {t.lines} lines</span></p>{canManage && <ReviewTender id={t.id} />}</li>)}</ul>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>All tenders</CardTitle></CardHeader>
        <CardContent>
          {!d.tenders.length ? <p className="py-6 text-center text-sm text-muted-foreground">No tenders yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="td-admin-all">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-normal">Tender</th><th className="py-2 pr-3 font-normal">Buyer</th><th className="py-2 pr-3 font-normal">Status</th><th className="py-2 pr-3 text-right font-normal">Lines</th><th className="py-2 pr-3 text-right font-normal">Bids</th><th className="py-2 font-normal">Closes</th></tr></thead>
                <tbody>{d.tenders.map((t) => (
                  <tr key={t.id} className="border-t" data-testid="td-admin-row">
                    <td className="py-2 pr-3"><Link href={`/admin/orders/tenders/${t.id}`} className="break-words text-primary hover:underline">{t.number} · {t.title}</Link></td>
                    <td className="break-words py-2 pr-3">{t.buyer}</td>
                    <td className="py-2 pr-3"><Badge variant={statusTone(t.status)}>{t.status.toLowerCase()}</Badge></td>
                    <td className="py-2 pr-3 text-right tabular-nums">{t.lines}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{t.bids}</td>
                    <td className="whitespace-nowrap py-2">{formatDate(t.closesAt, "en", true)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
