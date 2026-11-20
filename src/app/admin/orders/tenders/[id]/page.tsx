import Link from "next/link";
import { notFound } from "next/navigation";
import { Gavel } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { buyerTender } from "@/server/tenders/service";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReviewTender } from "@/components/pay-later/admin";
import { statusTone } from "@/components/tenders/labels";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Tender" };
export const dynamic = "force-dynamic";

export default async function AdminTenderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage", "admin.settings.manage"]);
  const { id } = await params;
  const d = await buyerTender(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const t = d.tender, eur = (n: number) => formatMoney(n, "en");
  const canManage = ctx.permissions.has("admin.orders.manage") || ctx.permissions.has("admin.settings.manage");
  return (
    <>
      <PageHeader title={t.title} icon={Gavel} eyebrow={t.number} description={t.note ?? undefined} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link href="/admin/orders/tenders" className="text-primary hover:underline">← Tenders</Link>
        <Badge variant={statusTone(t.status)} data-testid="td-status">{t.status.toLowerCase()}</Badge>
        <span className="text-muted-foreground">{t.buyer} · closes {formatDate(t.closesAt, "en", true)}{t.deliveryDate ? ` · delivery ${formatDate(t.deliveryDate, "en")}` : ""} · {d.suppliers} suppliers bid{t.invited.length ? ` · invited only: ${t.invited.join(", ")}` : ""}</span>
      </div>
      {t.status === "PENDING" && canManage && <Card className="mb-6"><CardContent className="pt-6"><ReviewTender id={t.id} /></CardContent></Card>}
      <Card>
        <CardHeader><CardTitle>Lines and bids (selling prices, excl. VAT)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {d.lines.map((x) => (
            <div key={x.id} className="rounded-lg border p-3 text-sm" data-testid="td-admin-line">
              <p className="mb-1 break-words font-medium">{x.n}. {x.description} <span className="font-normal text-muted-foreground">× {x.qty}{x.targetUnitNet != null ? ` · target ${eur(x.targetUnitNet)}` : ""}</span></p>
              {!x.bids.length ? <p className="text-xs text-muted-foreground">No bids.</p> : (
                <ul className="space-y-1">{x.bids.map((b) => <li key={b.bidLineId} className="flex flex-wrap justify-between gap-2"><span className="min-w-0 break-words">{b.rank}. {b.supplier} <span className="text-xs text-muted-foreground">{b.offer}</span>{b.bidLineId === x.awardedBidLineId && <Badge className="ml-2" variant="success">awarded{x.order ? ` · ${x.order.number}` : ""}</Badge>}</span><span className="tabular-nums">{eur(b.unitNet)} · {eur(b.total)}</span></li>)}</ul>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
