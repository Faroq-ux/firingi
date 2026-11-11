import Link from "next/link";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminTraceOffers, traceLot } from "@/server/warehouse/recalls";
import { AppError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RecallForm, TracePicker } from "@/components/warehouse/controls";
import { TraceView } from "@/components/warehouse/trace-view";
import { English, englishT } from "@/components/warehouse/english";

export const metadata = { title: "Lot traceability" };

export default async function AdminTrace({ searchParams }: { searchParams: Promise<{ offer?: string; lot?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.inventory.view", "admin.inventory.manage", "admin.recalls.manage"]);
  const sp = await searchParams;
  const t = englishT;
  const offers = await adminTraceOffers(ctx, "en");
  let data: Awaited<ReturnType<typeof traceLot>> | null = null, error: string | null = null;
  if (sp.offer && sp.lot) {
    try { data = await traceLot(ctx, { offerId: sp.offer, lotCode: sp.lot }, "en"); } catch (e) { if (e instanceof AppError) error = e.message; else throw e; }
  }
  const open = data?.recalls.find((r) => r.status === "OPEN");
  return (
    <English>
      <PageHeader title="Lot traceability" description="Follow any supplier's lot: where it came from, where it is now, and every order down the chain — including the customers of wholesalers who bought it on FIRINGI." />
      <Card className="mb-6"><CardContent className="pt-6"><TracePicker offers={offers} offerId={sp.offer} lotCode={sp.lot} base="/admin/inventory/trace" /></CardContent></Card>
      {error && <p className="mb-4 text-sm text-destructive" role="alert">{error}</p>}
      {data && <TraceView data={data} t={t as never} locale="en" orderHref={(id) => `/admin/orders/${id}`} />}
      {data && can(ctx, "admin.recalls.manage") && (
        open ? <p className="mt-6 text-sm"><Link className="font-medium text-destructive underline" href={`/admin/inventory/recalls/${open.id}`}>Open recall {open.number}</Link></p> : (
          <Card className="mt-6 border-destructive/40" data-testid="recall-card">
            <CardHeader><CardTitle>Recall this lot</CardTitle><CardDescription>FIRINGI can recall any supplier&apos;s lot. The supplier is told, every level of stock is blocked, open orders move to other lots and every buyer down the chain gets a recall notice.</CardDescription></CardHeader>
            <CardContent><RecallForm offerId={data.product.id} lotCode={data.lotCode ?? sp.lot!} base="/admin/inventory/recalls" units={data.levels[0]?.stockUnits ?? 0} /></CardContent>
          </Card>
        )
      )}
    </English>
  );
}
