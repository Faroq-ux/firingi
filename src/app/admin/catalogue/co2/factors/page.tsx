import Link from "next/link";
import { Table2 } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { categoryTable } from "@/server/co2/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { FactorEdit } from "@/components/co2/admin";

export const metadata = { title: "CO₂ Category Values" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.manage", "admin.settings.manage"]);
  const rows = await categoryTable(ctx);
  const canManage = ctx.permissions.has("admin.catalogue.manage") || ctx.permissions.has("admin.settings.manage");
  return (
    <>
      <PageHeader title="CO₂ Category Values" icon={Table2} description="kg CO₂e per kg of product (cradle to gate). Empty = FIRINGI's starting value for that kind of category, else the parent's. Sub-categories without their own value inherit." />
      <Link href="/admin/catalogue/co2" className="mb-3 inline-block text-sm text-primary hover:underline">← Sustainability & CO₂</Link>
      <Card><CardContent className="pt-6">
        <ul className="divide-y text-sm" data-testid="co2-factor-rows">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2" style={{ paddingLeft: r.depth * 16 }} data-testid="co2-factor-row">
              <span className="min-w-0 flex-1 break-words">{r.name} <span className="text-xs text-muted-foreground">· {r.kgPerKg} kg CO₂e/kg{r.own ? " (FIRINGI)" : ""}</span></span>
              {canManage && <FactorEdit categoryId={r.id} kgPerKg={r.kgPerKg} own={r.own} source={r.source} />}
            </li>
          ))}
        </ul>
      </CardContent></Card>
    </>
  );
}
