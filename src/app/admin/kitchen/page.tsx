import Link from "next/link";
import { ChefHat } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminKitchenOverview } from "@/server/kitchen/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Menu Costing & Waste" };
export const dynamic = "force-dynamic";

const REASON: Record<string, string> = { EXPIRED: "Expired", SPOILED: "Spoiled", OVERPRODUCTION: "Over-production", PLATE_WASTE: "Plate waste", DAMAGED: "Damaged", PREP_LOSS: "Prep loss", OTHER: "Other" };
const eur = (n: number) => new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(n);

/** Phase 54: how businesses use menu costing, the food they waste and donate (last 30 days). */
export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage", "admin.analytics.view"]);
  const o = await adminKitchenOverview(ctx);
  const tile = (label: string, value: string) => <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-semibold tabular-nums">{value}</p></CardContent></Card>;
  return (
    <>
      <PageHeader title="Menu Costing & Waste" icon={ChefHat} description="Restaurants' and shops' menu costing and the food they waste and donate — last 30 days." actions={<Link href="/admin/settings/kitchen" className="text-sm text-primary hover:underline">Settings →</Link>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="admin-kitchen">
        {tile("Businesses using it", String(o.businesses))}
        {tile("Recipes", String(o.recipes))}
        {tile("Waste (cost)", eur(o.waste.cost))}
        {tile("Waste (kg)", o.waste.kg.toFixed(1))}
        {tile("Waste CO₂e (kg)", o.waste.co2.toFixed(1))}
        {tile("Donated (kg)", o.donations.kg.toFixed(1))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Why food is thrown away</CardTitle></CardHeader><CardContent>
          {o.byReason.length === 0 ? <p className="text-sm text-muted-foreground">No waste logged.</p> : <ul className="divide-y text-sm">{o.byReason.map((r) => <li key={r.reason} className="flex justify-between gap-2 py-1.5"><span>{REASON[r.reason] ?? r.reason} <span className="text-xs text-muted-foreground">· {r.count}</span></span><span className="tabular-nums">{eur(r.cost)}</span></li>)}</ul>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Most waste</CardTitle></CardHeader><CardContent>
          {o.top.length === 0 ? <p className="text-sm text-muted-foreground">No waste logged.</p> : <ul className="divide-y text-sm">{o.top.map((t) => <li key={t.companyId} className="flex justify-between gap-2 py-1.5"><span className="min-w-0 break-words">{t.name}</span><span className="tabular-nums">{eur(t.cost)} · {t.kg.toFixed(1)} kg</span></li>)}</ul>}
        </CardContent></Card>
      </div>
    </>
  );
}
