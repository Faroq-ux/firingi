import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { categoryTreeOrdered, catalogueOptions } from "@/server/data/catalogue-admin";
import { categoryInfo } from "@/server/catalogue/restrictions";
import { PageHeader } from "@/components/layout/page-header";
import { CategoryTree } from "@/components/admin/catalogue-editors";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.manage"]);
  const [rows, opts] = await Promise.all([categoryTreeOrdered(), catalogueOptions()]);
  const info = categoryInfo(rows);
  return (
    <>
      <PageHeader title="Categories" description="Unlimited levels. Tobacco / alcohol restrictions are inherited by every sub-category; deactivating a category hides its whole branch." />
      <CategoryTree
        canEdit={can(ctx, "admin.catalogue.manage")}
        taxes={opts.taxCategories.map((t) => ({ id: t.id, label: t.code }))}
        rows={rows.map((r) => ({
          id: r.id, parentId: r.parentId, depth: r.depth, name: r.name as { en: string }, ownRestriction: r.restriction, restriction: info.get(r.id)?.restriction ?? null,
          isActive: r.isActive, products: r._count.products, children: r._count.children, taxCode: r.defaultTaxCategory?.code ?? null, defaultTaxCategoryId: r.defaultTaxCategoryId,
        }))}
      />
    </>
  );
}
