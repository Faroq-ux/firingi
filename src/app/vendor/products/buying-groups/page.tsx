import { Users } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { supplierGroups, supplierOffers } from "@/server/buying-groups/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fill, groupLabels } from "@/components/buying-groups/labels";
import { GroupPricesForm, StopGroupPrices } from "@/components/buying-groups/client";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Buying Groups" };
export const dynamic = "force-dynamic";

export default async function VendorBuyingGroupsPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.pricing.manage", "vendor.promotions.manage"]);
  const [{ l, locale }, sg] = await Promise.all([groupLabels(), supplierGroups(ctx)]);
  const offers = sg.enabled && sg.groups.length ? await supplierOffers(ctx) : [];
  return (
    <>
      <PageHeader title={l.vTitle} icon={Users} description={l.vIntro} />
      {!sg.enabled ? <p className="rounded-xl border border-dashed p-6 text-center text-sm" data-testid="bg-closed">{l["closed.OFF"]}</p>
        : !sg.groups.length ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{l.vNoGroups}</p> : (
          <div className="grid gap-4 lg:grid-cols-2" data-testid="bg-vendor-groups">
            {sg.groups.map((g) => (
              <Card key={g.id} data-testid="bg-vendor-group">
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center gap-2"><CardTitle className="break-words text-base">{g.name}</CardTitle><span className="text-xs text-muted-foreground">{g.country}</span></div>
                  <CardDescription>{fill(l.vMembers, { n: g.members, buyers: g.buyers })}</CardDescription>
                  {g.description && <p className="break-words text-xs text-muted-foreground">{g.description}</p>}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {g.priceList ? <Badge variant="success" data-testid="bg-current">{fill(l.vCurrent, { n: g.priceList.items })}{g.priceList.validTo ? ` · ${fill(l.until, { date: formatDate(g.priceList.validTo, locale) })}` : ""}</Badge> : <Badge variant="secondary">{l.vNone}</Badge>}
                    {g.priceList && <StopGroupPrices l={l} groupId={g.id} />}
                  </div>
                  <details className="rounded-lg border p-3" data-testid="bg-set-prices">
                    <summary className="cursor-pointer text-sm font-medium">{l.vSet}</summary>
                    <div className="pt-3"><GroupPricesForm l={l} groupId={g.id} offers={offers} locale={locale} /></div>
                  </details>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
    </>
  );
}
