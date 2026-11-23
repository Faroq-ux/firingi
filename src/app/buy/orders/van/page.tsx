import Link from "next/link";
import { Truck } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myVanPurchases } from "@/server/vansales/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { MethodBadge } from "@/components/vansales/views";
import { fill, vsLabels } from "@/components/vansales/labels";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Bought from vans" };
export const dynamic = "force-dynamic";

export default async function BoughtFromVansPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place"]);
  const [{ l, locale }, rows] = await Promise.all([vsLabels(), myVanPurchases(ctx)]);
  const m = (n: number) => formatMoney(n, locale);
  return (
    <>
      <PageHeader title={l.boughtTitle} description={l.boughtIntro} icon={Truck} />
      <Card>
        <CardContent className="pt-6">
          {!rows.length ? <p className="text-sm text-muted-foreground" data-testid="vb-empty">{l.noneBought}</p> : (
            <ul className="divide-y" data-testid="vb-list">
              {rows.map((r) => (
                <li key={r.id} className="space-y-1 py-3 text-sm" data-testid="vb-row" data-order={r.orderNumber}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 basis-40 font-medium break-words">{r.supplier} <span className="font-normal text-muted-foreground">· {r.seller}</span></span>
                    <MethodBadge l={l} method={r.method} />
                    <span className="font-semibold tabular-nums">{m(r.gross)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{new Date(r.soldAt).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })}</span>
                    {r.orderId && <Link href={`/buy/orders/${r.orderId}`} className="text-foreground underline-offset-2 hover:underline">{l.viewOrder} {r.orderNumber}</Link>}
                    {r.invoiceNumber && <span>{l.invoice}: {r.invoiceNumber}</span>}
                    <span>{l.paid}: {m(r.paid)}</span>
                    {r.signedBy && <span>{fill(l.signedBy, { name: r.signedBy })}</span>}
                    {r.hasSignature && <a href={`/api/vansales/sales/${r.id}/signature`} target="_blank" rel="noreferrer" className="text-foreground underline-offset-2 hover:underline">{l.signature}</a>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
