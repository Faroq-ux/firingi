import Link from "next/link";
import { Gavel } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { supplierTenders } from "@/server/tenders/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fill, statusTone, tenderLabels } from "@/components/tenders/labels";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Tenders" };
export const dynamic = "force-dynamic";

export default async function VendorTendersPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.pricing.manage", "vendor.orders.manage"]);
  const [{ l, locale }, m] = await Promise.all([tenderLabels(), supplierTenders(ctx)]);
  return (
    <>
      <PageHeader title={l.vTitle} icon={Gavel} description={l.vIntro} />
      {!m.access.bid && <p className="mb-4 rounded-xl border border-dashed p-4 text-sm" data-testid="td-closed">{l[`closed.${m.access.why ?? "TYPE_OFF"}`]}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{l.vOpen}</CardTitle></CardHeader>
          <CardContent>
            {!m.open.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.vNoOpen}</p> : (
              <ul className="divide-y" data-testid="td-v-open">
                {m.open.map((t) => (
                  <li key={t.id} className="space-y-1 py-3 text-sm" data-testid="td-v-row">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/vendor/orders/tenders/${t.id}`} className="min-w-0 break-words font-medium text-primary hover:underline">{t.number} · {t.title}</Link>
                      {t.invited && <Badge variant="default">{l.invitedYou}</Badge>}
                      {t.myBid && <Badge variant={statusTone(t.myBid)}>{l[`bidStatus.${t.myBid}`]}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{t.buyer} · {fill(l.linesN, { n: t.lines })} · {fill(l.closesOn, { date: formatDate(t.closesAt, locale, true) })}{t.deliveryDate ? ` · ${fill(l.deliveryOn, { date: formatDate(t.deliveryDate, locale) })}` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{l.vMyBids}</CardTitle></CardHeader>
          <CardContent>
            {!m.bids.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.vNoBids}</p> : (
              <ul className="divide-y" data-testid="td-v-bids">
                {m.bids.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-2 py-3 text-sm" data-testid="td-v-bid" data-status={b.status}>
                    <Link href={`/vendor/orders/tenders/${b.tender.id}`} className="min-w-0 break-words text-primary hover:underline">{b.tender.number} · {b.tender.title}</Link>
                    <Badge variant={statusTone(b.status)}>{l[`bidStatus.${b.status}`]}</Badge>
                    <span className="ml-auto text-xs text-muted-foreground">{fill(l.linesN, { n: b.lines })}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
