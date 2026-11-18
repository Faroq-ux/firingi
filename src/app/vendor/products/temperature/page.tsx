import { Snowflake } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listClasses, vendorOfferClasses, categoryInheritance } from "@/server/coldchain/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OfferClassSelect } from "@/components/coldchain/client";
import { ccLabels } from "@/components/coldchain/labels";

export const metadata = { title: "Temperature" };
export const dynamic = "force-dynamic";

export default async function VendorTemperaturePage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.products.manage", "vendor.products.view"]);
  const { l, locale } = await ccLabels();
  const [offers, classes] = await Promise.all([vendorOfferClasses(ctx, locale), listClasses(locale)]);
  const inherited = await categoryInheritance(offers.map((o) => o.id));
  const edit = can(ctx, "vendor.products.manage");
  const opts = classes.map((c) => ({ id: c.id, name: c.name }));
  const sorted = [...offers].sort((a, b) => Number(!!b.effective) - Number(!!a.effective));
  return (
    <>
      <PageHeader title={l.productsTitle} icon={Snowflake} description={l.productsIntro} />
      <Card>
        <CardContent className="pt-2">
          {!sorted.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.noProducts}</p> : (
            <ul className="divide-y" data-testid="cc-offers">
              {sorted.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="cc-offer" data-offer={o.id}>
                  <span className="min-w-0 flex-1 basis-56 break-words font-medium">{o.name} <span className="text-xs font-normal text-muted-foreground">· {o.packaging}{o.sku ? ` · ${o.sku}` : ""}</span></span>
                  {edit ? <OfferClassSelect l={l} offerId={o.id} own={o.own} inherited={inherited.get(o.id) ?? null} classes={opts} />
                    : <Badge variant="outline">{classes.find((c) => c.id === o.effective)?.name ?? l.ambient}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
