import Link from "next/link";
import type { ProductStatus } from "@prisma/client";
import { getLocale } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminProducts } from "@/server/data/catalogue-admin";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";
import { listViews } from "@/server/services/workspace";
import { bulkApproveProductsAction } from "@/server/actions/catalogue";

export const metadata = { title: "Product Catalogue" };
const STATUS = { DRAFT: "secondary", PENDING_APPROVAL: "warning", APPROVED: "success", REJECTED: "destructive", ARCHIVED: "secondary" } as const;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.manage", "admin.catalogue.approve"]);
  const sp = await searchParams;
  const [data, locale] = await Promise.all([adminProducts(ctx, { q: sp.q, status: (sp.status || undefined) as ProductStatus | undefined, page: Number(sp.page) || 1, pageSize: 300 }), getLocale()]);
  const views = await listViews(ctx, "admin.products");
  return (
    <>
      <PageHeader
        title="Product Catalogue"
        description={`${data.total} master products. Vendors attach their own offers (price, stock) to these.`}
        actions={can(ctx, "admin.catalogue.manage") && <Link href="/admin/catalogue/products/new" className={buttonVariants()}>New product</Link>}
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={sp.q} placeholder="Name, brand, SKU, EAN" className="w-64" />
        <Select name="status" defaultValue={sp.status ?? ""} className="w-48"><option value="">All statuses</option>{Object.keys(STATUS).map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>)}</Select>
        <Button variant="outline" type="submit">Filter</Button>
      </form>
      <DataTable tableId="admin.products" views={views} empty="No products." exportName="products"
        columns={[{ key: "product", label: "Product" }, { key: "category", label: "Category" }, { key: "vat", label: "VAT" }, { key: "skus", label: "SKUs" }, { key: "offers", label: "Offers", type: "number" }, { key: "status", label: "Status", type: "badge" }]}
        bulk={can(ctx, "admin.catalogue.approve") ? [{ key: "approve", label: "Approve selected", action: bulkApproveProductsAction }] : []}
        rows={data.rows.map((p) => ({
          id: p.id, href: `/admin/catalogue/products/${p.id}`,
          cells: {
            product: { t: pickLocalized(p.name, locale), sub: `${p.brand?.name ?? ""}${p.proposedBy ? ` · proposed by ${p.proposedBy.legalName}` : ""}` },
            category: `${pickLocalized(p.category.name, locale)}${(p.restriction ?? p.category.restriction) ? ` · ${p.restriction ?? p.category.restriction}` : ""}`,
            vat: p.taxCategory.code, skus: { t: p.variants.map((v) => v.sku).join(", "), mono: true },
            offers: p.variants.reduce((a, v) => a + v.packagings.reduce((b, pk) => b + pk._count.offers, 0), 0),
            status: { t: p.status.replace("_", " ").toLowerCase(), tone: STATUS[p.status] },
          },
        }))} />
      <p className="mt-3 text-sm text-muted-foreground">Page {data.page} of {data.pageCount}</p>
    </>
  );
}
