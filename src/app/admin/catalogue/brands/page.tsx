import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminBrands } from "@/server/data/catalogue-admin";
import { PageHeader } from "@/components/layout/page-header";
import { BrandRow } from "@/components/admin/catalogue-editors";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Brands" };

export default async function BrandsPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.manage"]);
  const rows = await adminBrands(ctx);
  const edit = can(ctx, "admin.catalogue.manage");
  return (
    <>
      <PageHeader title="Brands" />
      {edit && <Card className="mb-4"><CardContent className="pt-5"><BrandRow /></CardContent></Card>}
      <ul className="divide-y rounded-xl border bg-card">
        {rows.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-3 p-3">
            {edit ? <BrandRow id={b.id} name={b.name} isActive={b.isActive} /> : <span>{b.name}</span>}
            <span className="text-sm text-muted-foreground">{b._count.products} products</span>
          </li>
        ))}
      </ul>
    </>
  );
}
