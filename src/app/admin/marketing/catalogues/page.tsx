import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listCatalogues, mcSettings } from "@/server/marketing/catalogues";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { McSettingsForm } from "@/components/marketing/catalogue-editor";

export const metadata = { title: "Marketing Catalogues" };
const SCOPE: Record<string, string> = { ALL: "All wholesalers", WHOLESALER: "Wholesalers", ZONE: "Delivery zones", DISTRICT: "Districts" };

/** FIRINGI (English): product catalogues / brochures for marketing — by hand or with AI, PDF + share link, sent to customers. */
export default async function CataloguesPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage"]);
  const [list, s] = await Promise.all([listCatalogues(ctx), mcSettings()]);
  const manage = can(ctx, "admin.marketing.manage");
  return (
    <>
      <PageHeader icon={BookOpen} title="Marketing Catalogues" description="Product catalogues for marketing — for all wholesalers, some wholesalers, delivery zones or districts. Pick products with filters or let AI build it; choose price, barcode and quantities; download the PDF, share the link or send it to customers. Or upload your own PDF."
        actions={manage ? <Link href="/admin/marketing/catalogues/new" className={buttonVariants()} data-testid="mc-new"><Plus className="size-4" /> New catalogue</Link> : undefined} />
      {manage && <Card className="mb-6"><CardContent className="pt-6"><McSettingsForm initial={s} /></CardContent></Card>}
      <Table data-testid="mc-list">
        <THead><TR><TH>Catalogue</TH><TH>For</TH><TH>Language</TH><TH>Products</TH><TH>Status</TH><TH className="text-right">Views</TH></TR></THead>
        <TBody>
          {list.length === 0 && <TR><TD colSpan={6} className="py-8 text-center text-muted-foreground">No catalogues yet.</TD></TR>}
          {list.map((c) => (
            <TR key={c.id} data-testid="mc-row">
              <TD><Link href={`/admin/marketing/catalogues/${c.id}`} className="font-medium text-primary hover:underline">{c.title}</Link>{c.subtitle && <div className="text-xs text-muted-foreground">{c.subtitle}</div>}</TD>
              <TD className="text-sm">{SCOPE[c.scope]}{c.scopeIds.length ? ` (${c.scopeIds.length})` : ""}</TD>
              <TD className="text-sm">{c.locale}</TD>
              <TD className="text-sm">{c.uploadKey ? "own PDF" : Array.isArray(c.items) ? c.items.length : 0}</TD>
              <TD className="text-sm">{c.status.toLowerCase()}</TD>
              <TD className="text-right tabular-nums">{c.views}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
