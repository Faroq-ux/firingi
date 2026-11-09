import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminProduct, catalogueOptions } from "@/server/data/catalogue-admin";
import { NotFoundError } from "@/server/errors";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AddPackagingForm, AddVariantForm, ImageUpload, PackagingActiveToggle, ProductDecision, ProductForm, VariantActiveToggle,
} from "@/components/admin/catalogue-editors";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.manage", "admin.catalogue.approve"]);
  const { id } = await params;
  const p = await adminProduct(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const [o, locale] = await Promise.all([catalogueOptions(), getLocale()]);
  const edit = can(ctx, "admin.catalogue.manage");
  const L = (v: unknown) => pickLocalized(v, locale);
  const units = o.units.map((u) => ({ id: u.code, label: u.code }));
  return (
    <>
      <Link href="/admin/catalogue/products" className="text-sm text-primary hover:underline">← Product Catalogue</Link>
      <PageHeader title={L(p.name)} description={<span className="flex items-center gap-2"><Badge variant={p.status === "APPROVED" ? "success" : p.status === "PENDING_APPROVAL" ? "warning" : "secondary"}>{p.status.replace("_", " ").toLowerCase()}</Badge>{p.proposedBy && <>proposed by <Link className="text-primary hover:underline" href={`/admin/companies/${p.proposedBy.id}`}>{p.proposedBy.legalName}</Link></>}</span>} />
      {p.status === "PENDING_APPROVAL" && can(ctx, "admin.catalogue.approve") && (
        <Card className="mb-4 border-warning/50"><CardHeader><CardTitle>Approval</CardTitle><CardDescription>Approving makes the vendor&apos;s pending offer live.</CardDescription></CardHeader><CardContent><ProductDecision productId={p.id} /></CardContent></Card>
      )}
      {p.reviewNote && <p className="mb-4 text-sm text-muted-foreground">Review note: {p.reviewNote}</p>}
      <Card className="mb-4">
        <CardHeader><CardTitle>Product</CardTitle></CardHeader>
        <CardContent>
          {edit ? (
            <ProductForm
              data={{ id: p.id, name: p.name as { en: string }, description: p.description as { en: string } | null, categoryId: p.categoryId, brandId: p.brandId, taxCategoryId: p.taxCategoryId, restriction: p.restriction, hsCode: p.hsCode, originCountryCode: p.originCountryCode }}
              categories={o.categories.map((c) => ({ id: c.id, label: `${"— ".repeat(c.depth)}${L(c.name)}` }))}
              brands={o.brands.map((b) => ({ id: b.id, label: b.name }))}
              taxes={o.taxCategories.map((t) => ({ id: t.id, label: t.code }))}
            />
          ) : <p className="text-sm">{L(p.category.name)} · {p.brand?.name}</p>}
        </CardContent>
      </Card>
      <Card className="mb-4">
        <CardHeader><CardTitle>Images</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.images.map((_, i) => <img key={i} src={`/api/catalogue/images/${p.id}/${i}`} alt="" className="size-24 rounded-md border object-contain" />)}
            {p.images.length === 0 && <span className="text-sm text-muted-foreground">No images.</span>}
          </div>
          {edit && <ImageUpload productId={p.id} />}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Variants & packaging</CardTitle><CardDescription>Vendors sell a packaging unit of a variant (e.g. &quot;Case 24 × 33cl&quot;).</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {p.variants.map((v) => (
            <div key={v.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-semibold">{v.sku}</code>
                {v.gtin && <span className="font-mono text-xs text-muted-foreground">EAN {v.gtin}</span>}
                {v.attributes && <span className="text-xs">{Object.entries(v.attributes as Record<string, string>).map(([k, x]) => `${k}: ${x}`).join(", ")}</span>}
                {!v.isActive && <Badge variant="secondary">inactive</Badge>}
                {edit && <span className="ml-auto"><VariantActiveToggle id={v.id} productId={p.id} isActive={v.isActive} /></span>}
              </div>
              <ul className="space-y-1 pl-4 text-sm">
                {v.packagings.map((pk) => (
                  <li key={pk.id} className="flex flex-wrap items-center gap-2">
                    <span className={pk.isActive ? "" : "text-muted-foreground line-through"}>{L(pk.name)}</span>
                    <span className="text-xs text-muted-foreground">{pk.unitsPerPack} × {pk.uomCode}{pk.gtin ? ` · ${pk.gtin}` : ""}</span>
                    <span className="text-xs">{pk.offers.length} offer(s): {pk.offers.map((x) => x.vendor.legalName).join(", ")}</span>
                    {edit && <PackagingActiveToggle id={pk.id} variantId={v.id} uomCode={pk.uomCode} name={pk.name as { en: string }} unitsPerPack={pk.unitsPerPack} isActive={pk.isActive} />}
                  </li>
                ))}
              </ul>
              {edit && <div className="pl-4"><AddPackagingForm variantId={v.id} units={units} /></div>}
            </div>
          ))}
          {edit && <AddVariantForm productId={p.id} />}
        </CardContent>
      </Card>
    </>
  );
}
