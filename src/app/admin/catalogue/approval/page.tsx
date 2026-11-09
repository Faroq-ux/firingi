import Link from "next/link";
import { getLocale } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminOffers, adminProducts } from "@/server/data/catalogue-admin";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { OfferDecision, ProductDecision } from "@/components/admin/catalogue-editors";

export const metadata = { title: "Product Approval" };

export default async function ApprovalPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, "admin.catalogue.approve");
  const [products, offers, locale] = await Promise.all([
    adminProducts(ctx, { status: "PENDING_APPROVAL" }),
    adminOffers(ctx, { status: "PENDING_APPROVAL" }),
    getLocale(),
  ]);
  const standaloneOffers = offers.rows.filter((o) => o.packaging.variant.product.status === "APPROVED");
  return (
    <>
      <PageHeader title="Product Approval" description="New products proposed by vendors, and offers waiting for approval (if offer approval is switched on)." />
      <Card className="mb-6">
        <CardHeader><CardTitle>Proposed products ({products.total})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <THead><TR><TH>Product</TH><TH>Vendor</TH><TH>Category</TH><TH className="text-right">Decision</TH></TR></THead>
            <TBody>
              {products.rows.length === 0 && <EmptyRow colSpan={4}>Nothing to review.</EmptyRow>}
              {products.rows.map((p) => (
                <TR key={p.id}>
                  <TD><Link href={`/admin/catalogue/products/${p.id}`} className="font-medium text-primary hover:underline">{pickLocalized(p.name, locale)}</Link><div className="font-mono text-xs text-muted-foreground">{p.variants.map((v) => v.sku).join(", ")}</div></TD>
                  <TD>{p.proposedBy?.legalName}</TD>
                  <TD>{pickLocalized(p.category.name, locale)}</TD>
                  <TD><ProductDecision productId={p.id} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Offers waiting for approval ({standaloneOffers.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <THead><TR><TH>Product</TH><TH>Vendor</TH><TH className="text-right">Decision</TH></TR></THead>
            <TBody>
              {standaloneOffers.length === 0 && <EmptyRow colSpan={3}>Nothing to review.</EmptyRow>}
              {standaloneOffers.map((o) => (
                <TR key={o.id}>
                  <TD>{pickLocalized(o.packaging.variant.product.name, locale)} <span className="text-xs text-muted-foreground">· {pickLocalized(o.packaging.name, locale)}</span></TD>
                  <TD>{o.vendor.legalName}</TD>
                  <TD><OfferDecision offerId={o.id} status={o.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
