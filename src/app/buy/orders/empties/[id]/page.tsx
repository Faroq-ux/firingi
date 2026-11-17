import Link from "next/link";
import { PackageOpen } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { getReturn } from "@/server/returnables/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DisputeForm } from "@/components/returnables/client";
import { RET_TONE, ReturnLines } from "@/components/returnables/views";
import { fill, rtLabels } from "@/components/returnables/labels";

export const metadata = { title: "Empties return" };
export const dynamic = "force-dynamic";

export default async function BuyerReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place", "buyer.invoices.view"]);
  const { l, locale } = await rtLabels();
  const r = await getReturn(ctx, (await params).id, locale);
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  const short = r.lines.some((x) => x.accepted != null && (x.counted > x.accepted + x.damaged || x.damaged > 0));
  return (
    <>
      <PageHeader title={fill(l.returnTitle, { number: r.number })} icon={PackageOpen} description={`${r.supplier} · ${l[`source.${r.source}`]}`} actions={<Link href="/buy/orders/empties" className="text-sm text-primary">← {l.emptiesTitle}</Link>} />
      <Card>
        <CardHeader><CardTitle className="flex flex-wrap items-center gap-2">{l.whatCameBack} <Badge variant={RET_TONE[r.status]} data-testid="return-status">{l[`status.${r.status}`]}</Badge></CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {r.status === "COLLECTED" && <p className="text-sm text-muted-foreground">{l.beingChecked}</p>}
          <ReturnLines l={l} lines={r.lines} />
          {r.creditGross > 0 && <p className="text-sm" data-testid="return-refund">{fill(l.refundedTo, { amount: money(r.creditGross), notes: r.creditNotes.map((n) => n.number).join(", ") })}</p>}
          {r.disputeNote && <p className="rounded-lg bg-muted/60 p-2 text-sm">{fill(l.youContested, { note: r.disputeNote })}</p>}
          {r.resolution && <p className="text-sm">{fill(l.firingiDecided, { note: r.resolution })}</p>}
          {r.status === "CONFIRMED" && short && <DisputeForm l={l} id={r.id} />}
        </CardContent>
      </Card>
    </>
  );
}
