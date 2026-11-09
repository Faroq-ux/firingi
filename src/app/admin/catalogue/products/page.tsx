import Link from "next/link";
import type { ProductStatus } from "@prisma/client";
import { getLocale } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminProducts } from "@/server/data/catalogue-admin";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata = { title: "Product Catalogue" };
const STATUS = { DRAFT: "secondary", PENDING_APPROVAL: "warning", APPROVED: "success", REJECTED: "destructive", ARCHIVED: "secondary" } as const;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.manage", "admin.catalogue.approve"]);
  const sp = await searchParams;
  const [data, locale] = await Promise.all([adminProducts(ctx, { q: sp.q, status: (sp.status || undefined) as ProductStatus | undefined, page: Number(sp.page) || 1 }), getLocale()]);
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
      <Table>
        <THead><TR><TH>Product</TH><TH>Category</TH><TH>VAT</TH><TH>SKUs</TH><TH className="text-right">Offers</TH><TH>Status</TH></TR></THead>
        <TBody>
          {data.rows.length === 0 && <EmptyRow colSpan={6}>No products.</EmptyRow>}
          {data.rows.map((p) => (
            <TR key={p.id}>
              <TD>
                <Link href={`/admin/catalogue/products/${p.id}`} className="font-medium text-primary hover:underline">{pickLocalized(p.name, locale)}</Link>
                <div className="text-xs text-muted-foreground">{p.brand?.name}{p.proposedBy ? ` · proposed by ${p.proposedBy.legalName}` : ""}</div>
              </TD>
              <TD>{pickLocalized(p.category.name, locale)} {(p.restriction ?? p.category.restriction) && <Badge variant="warning">{p.restriction ?? p.category.restriction}</Badge>}</TD>
              <TD>{p.taxCategory.code}</TD>
              <TD className="font-mono text-xs">{p.variants.map((v) => v.sku).join(", ")}</TD>
              <TD className="text-right tabular-nums">{p.variants.reduce((a, v) => a + v.packagings.reduce((b, pk) => b + pk._count.offers, 0), 0)}</TD>
              <TD><Badge variant={STATUS[p.status]}>{p.status.replace("_", " ").toLowerCase()}</Badge></TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <p className="mt-3 text-sm text-muted-foreground">Page {data.page} of {data.pageCount}</p>
    </>
  );
}
