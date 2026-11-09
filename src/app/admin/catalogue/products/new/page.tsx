import { getLocale } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { catalogueOptions } from "@/server/data/catalogue-admin";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ProductForm } from "@/components/admin/catalogue-editors";

export const metadata = { title: "New product" };

export default async function NewProductPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, "admin.catalogue.manage");
  const [o, locale] = await Promise.all([catalogueOptions(), getLocale()]);
  return (
    <>
      <PageHeader title="New product" description="Created products are approved immediately. Add variants and packaging after saving." />
      <Card><CardContent className="pt-5">
        <ProductForm
          data={{ name: { en: "" }, description: null, categoryId: "", brandId: null, taxCategoryId: o.taxCategories.find((t) => t.code === "STANDARD")!.id, restriction: null, hsCode: null, originCountryCode: null }}
          categories={o.categories.map((c) => ({ id: c.id, label: `${"— ".repeat(c.depth)}${pickLocalized(c.name, locale)}` }))}
          brands={o.brands.map((b) => ({ id: b.id, label: b.name }))}
          taxes={o.taxCategories.map((t) => ({ id: t.id, label: t.code }))}
        />
      </CardContent></Card>
    </>
  );
}
