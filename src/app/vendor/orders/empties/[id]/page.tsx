import Link from "next/link";
import { PackageOpen } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { getReturn } from "@/server/returnables/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmReturnForm } from "@/components/returnables/client";
import { RET_TONE, ReturnLines } from "@/components/returnables/views";
import { fill, rtLabels } from "@/components/returnables/labels";

export const metadata = { title: "Empties return" };
export const dynamic = "force-dynamic";

export default async function VendorReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.orders.view", "vendor.orders.manage"]);
  const { l, locale } = await rtLabels();
  const r = await getReturn(ctx, (await params).id, locale);
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  return (
    <>
      <PageHeader title={fill(l.returnTitle, { number: r.number })} icon={PackageOpen} description={`${r.customer} · ${l[`source.${r.source}`]}`} actions={<Link href="/vendor/orders/empties" className="text-sm text-primary">← {l.emptiesTitle}</Link>} />
      <Card className="mb-6">
        <CardHeader><CardTitle className="flex flex-wrap items-center gap-2">{l.whatCameBack} <Badge variant={RET_TONE[r.status]} data-testid="return-status">{l[`status.${r.status}`]}</Badge></CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <ReturnLines l={l} lines={r.lines} />
          {r.note && <p className="text-sm">“{r.note}”</p>}
          {r.creditGross > 0 && <p className="text-sm">{fill(l.refundedTo, { amount: money(r.creditGross), notes: r.creditNotes.map((n) => n.number).join(", ") })}</p>}
          {r.disputeNote && <p className="rounded-lg bg-muted/60 p-2 text-sm">{fill(l.customerContests, { note: r.disputeNote })}</p>}
          {r.resolution && <p className="text-sm">{fill(l.firingiDecided, { note: r.resolution })}</p>}
        </CardContent>
      </Card>
      {r.status === "COLLECTED" && (
        <Card><CardHeader><CardTitle>{l.checkTitle}</CardTitle></CardHeader><CardContent><ConfirmReturnForm l={l} id={r.id} lines={r.lines} /></CardContent></Card>
      )}
    </>
  );
}
