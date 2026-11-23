import Link from "next/link";
import { notFound } from "next/navigation";
import { ListChecks } from "lucide-react";
import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { assortmentDetail, targetOptions, vendorAssortments } from "@/server/assortments/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AddItems, EditListForm, ItemRow } from "@/components/assortments/client";
import { asLabels } from "@/components/assortments/labels";

export const metadata = { title: "Assortment list" };
export const dynamic = "force-dynamic";

export default async function AssortmentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.pricing.manage", "vendor.products.view"]);
  const manage = can(ctx, "vendor.pricing.manage");
  const { id } = await params;
  const [{ l }, a, o, t] = await Promise.all([asLabels(), assortmentDetail(ctx, id).catch(() => null), vendorAssortments(ctx), targetOptions(ctx)]);
  if (!a) notFound();
  return (
    <>
      <PageHeader title={a.name} description={l[`modeHint.${a.mode}`]} icon={ListChecks}
        actions={<div className="flex flex-wrap items-center gap-2"><Badge variant={a.active ? "success" : "secondary"} data-testid="as-state">{a.active ? l.active : l.inactive}</Badge><Badge variant="secondary" data-mode={a.mode} data-testid="as-mode">{l[`mode.${a.mode}`]}</Badge><Link href="/vendor/products/assortments" className="text-sm underline-offset-2 hover:underline">{l.lists}</Link></div>} />
      {manage && o.on && (
        <Card className="mb-6">
          <CardHeader><CardTitle>{l.edit}</CardTitle><CardDescription>{l.for}: {a.targetName ?? l[`target.${a.target}`]}</CardDescription></CardHeader>
          <CardContent><EditListForm l={l} groups={t.groups} modes={o.modes} list={a} /></CardContent>
        </Card>
      )}
      <Card className="mb-6">
        <CardHeader><CardTitle>{l.products} · {a.items.length}</CardTitle></CardHeader>
        <CardContent>
          {!a.items.length ? <p className="text-sm text-muted-foreground" data-testid="as-no-items">{l.noItems}</p> : (
            <ul className="divide-y" data-testid="as-items">
              {a.items.map((x) => (
                <li key={x.offerId} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="as-item" data-offer={x.offerId}>
                  <span className="min-w-0 flex-1 basis-48 break-words">{x.name} <span className="text-xs text-muted-foreground">· {x.packaging} · {x.sku}</span></span>
                  {x.mustStock && a.mode !== "MUST_STOCK" && <Badge variant="warning">{l.mustStock}</Badge>}
                  {!x.active && <Badge variant="secondary">{l.unavailable}</Badge>}
                  {manage && <ItemRow l={l} id={a.id} offerId={x.offerId} mustStock={x.mustStock} canMark={a.mode === "ONLY_LISTED"} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {manage && o.on && (
        <Card>
          <CardHeader><CardTitle>{l.addProducts}</CardTitle></CardHeader>
          <CardContent><AddItems l={l} id={a.id} /></CardContent>
        </Card>
      )}
    </>
  );
}
