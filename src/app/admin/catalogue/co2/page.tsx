import Link from "next/link";
import { Leaf, Settings, Table2 } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminOverview, pendingValues } from "@/server/co2/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { co2Labels, kgText } from "@/components/co2/labels";
import { Co2Report } from "@/components/co2/report";
import { ReviewValue } from "@/components/co2/admin";

export const metadata = { title: "Sustainability & CO₂" };
export const dynamic = "force-dynamic";

export default async function AdminCo2Page({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.manage", "admin.catalogue.approve", "admin.settings.manage"]);
  const now = new Date().getUTCFullYear();
  const year = Math.min(now, Math.max(2020, Number((await searchParams).year) || now));
  const [o, pending, { l }] = await Promise.all([adminOverview(ctx, year), pendingValues(ctx), co2Labels(true)]);
  const canManage = ctx.permissions.has("admin.catalogue.manage") || ctx.permissions.has("admin.catalogue.approve") || ctx.permissions.has("admin.settings.manage");
  return (
    <>
      <PageHeader title="Sustainability & CO₂" icon={Leaf} description="The marketplace's footprint: products (per kg), packaging, delivery (distance × weight × fuel) and local sourcing. Category values are FIRINGI's; suppliers' exact values are checked here."
        actions={<><Link href="/admin/catalogue/co2/factors" className={buttonVariants({ variant: "outline" })} data-testid="co2-factors-link"><Table2 className="size-4" /> Category values</Link><Link href="/admin/catalogue/co2/settings" className={buttonVariants({ variant: "outline" })} data-testid="co2-settings-link"><Settings className="size-4" /> Settings</Link></>} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Values to check</p><p className="text-xl font-semibold tabular-nums" data-testid="co2-t-pending">{o.pending}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Offers with suppliers&apos; own values</p><p className="text-xl font-semibold tabular-nums">{o.ownValues} ({o.coverage} %)</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Footprint {year}</p><p className="text-xl font-semibold tabular-nums">{o.report ? kgText(o.report.total, "en") : "—"}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Delivered orders counted</p><p className="text-xl font-semibold tabular-nums">{o.report?.orders ?? 0}</p></CardContent></Card>
      </div>
      {pending.length > 0 && (
        <Card className="mb-6" data-testid="co2-pending">
          <CardHeader><CardTitle>Suppliers&apos; values to check</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y">{pending.map((p) => (
              <li key={p.offerId} className="space-y-2 py-3 text-sm" data-testid="co2-pending-row">
                <p className="break-words"><span className="font-medium">{p.product}</span> <span className="text-xs text-muted-foreground">{p.sku} · {p.supplier}</span></p>
                <p className="text-xs text-muted-foreground">{p.kgPerKg != null ? `${p.kgPerKg} kg CO₂e/kg (category ${p.categoryKgPerKg ?? "—"})` : "no production value"}{p.packaging ? ` · ${p.packaging.toLowerCase()}${p.recyclable ? ", recyclable" : ""}` : ""}{p.source ? ` · source: ${p.source}` : ""}</p>
                {canManage && <ReviewValue offerId={p.offerId} />}
              </li>
            ))}</ul>
          </CardContent>
        </Card>
      )}
      {o.suppliers.some((x) => x.grade) && (
        <Card className="mb-6"><CardHeader><CardTitle>Suppliers&apos; green grade</CardTitle></CardHeader><CardContent><ul className="divide-y text-sm" data-testid="co2-grades">{o.suppliers.filter((x) => x.grade).slice(0, 30).map((x) => <li key={x.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span className="min-w-0 break-words">{x.name} <span className="text-xs text-muted-foreground">· {x.type.toLowerCase()}</span></span><span className="font-semibold">{x.grade} <span className="text-xs font-normal text-muted-foreground">{x.score}/100</span></span></li>)}</ul></CardContent></Card>
      )}
      {o.report && <Co2Report r={o.report} l={l} locale="en" exportBase={`/api/co2/export?side=ADMIN&year=${year}`} partyLabel="By customer" years={[now - 2, now - 1, now]} yearHref={(y) => `?year=${y}`} />}
    </>
  );
}
