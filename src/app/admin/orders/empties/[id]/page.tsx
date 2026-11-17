import Link from "next/link";
import { PackageOpen } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { can } from "@/server/rbac/guard";
import { getReturn } from "@/server/returnables/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ResolveForm } from "@/components/returnables/client";
import { RET_TONE, ReturnLines } from "@/components/returnables/views";
import { enLabels } from "@/components/returnables/labels";

export const metadata = { title: "Empties return" };
export const dynamic = "force-dynamic";

export default async function AdminReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage", "admin.claims.manage"]);
  const l = enLabels();
  const r = await getReturn(ctx, (await params).id, "en");
  const money = (n: number) => new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(n);
  return (
    <>
      <PageHeader title={`Empties return ${r.number}`} icon={PackageOpen} description={`${r.customer} → ${r.supplier} · ${l[`source.${r.source}`]}`} actions={<Link href="/admin/orders/empties" className="text-sm text-primary">← Empties & Deposits</Link>} />
      <Card className="mb-6">
        <CardHeader><CardTitle className="flex flex-wrap items-center gap-2">What came back <Badge variant={RET_TONE[r.status]} data-testid="return-status">{l[`status.${r.status}`]}</Badge></CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <ReturnLines l={l} lines={r.lines} />
          {r.note && <p className="text-sm">Note: “{r.note}”</p>}
          {r.creditGross > 0 && <p className="text-sm">Refunded {money(r.creditGross)} ({r.creditNotes.map((n) => n.number).join(", ")}).</p>}
          {r.disputeNote && <p className="rounded-lg bg-muted/60 p-2 text-sm">The customer contests: “{r.disputeNote}”</p>}
          {r.resolution && <p className="text-sm">Decision: {r.resolution}</p>}
        </CardContent>
      </Card>
      {r.status === "DISPUTED" && can(ctx, ["admin.orders.manage", "admin.claims.manage"]) && <Card><CardHeader><CardTitle>Decide</CardTitle></CardHeader><CardContent><ResolveForm id={r.id} /></CardContent></Card>}
    </>
  );
}
