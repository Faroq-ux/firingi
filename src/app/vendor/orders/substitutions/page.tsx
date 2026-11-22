import { Repeat } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { substitutionSettings } from "@/server/substitutions/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LinksEditor } from "@/components/substitutions/client";
import { RecentSubstitutions } from "@/components/substitutions/views";
import { subLabels } from "@/components/substitutions/labels";

export const metadata = { title: "Replacements" };
export const dynamic = "force-dynamic";

export default async function VendorSubstitutionsPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.orders.view", "vendor.orders.manage", "vendor.products.manage"]);
  const [{ l }, s] = await Promise.all([subLabels(), substitutionSettings()]);
  return (
    <>
      <PageHeader title={l.title} description={l.pageIntroSupplier} icon={Repeat} />
      {!s.enabled && <p className="mb-4 rounded-md bg-muted p-3 text-sm" data-testid="sub-off">{l.off}</p>}
      {ctx.permissions.has("vendor.products.manage") && (
        <Card>
          <CardHeader><CardTitle>{l.linksTitle}</CardTitle><CardDescription>{l.pageIntroSupplier}</CardDescription></CardHeader>
          <CardContent><LinksEditor l={l} /></CardContent>
        </Card>
      )}
      {(ctx.permissions.has("vendor.orders.view") || ctx.permissions.has("vendor.orders.manage")) && <RecentSubstitutions ctx={ctx} portal="vendor" />}
    </>
  );
}
