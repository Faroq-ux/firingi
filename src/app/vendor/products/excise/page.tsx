import Link from "next/link";
import { Wine } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { vendorExciseOffers } from "@/server/excise/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OfferExciseForm } from "@/components/excise/client";
import { exLabels, fill } from "@/components/excise/labels";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Licensed Goods" };
export const dynamic = "force-dynamic";

export default async function VendorExcisePage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.products.manage", "vendor.products.view"]);
  const { l, locale } = await exLabels();
  const v = await vendorExciseOffers(ctx, locale);
  const edit = can(ctx, "vendor.products.manage");
  return (
    <>
      <PageHeader title={l.productsTitle} icon={Wine} description={l.productsIntro} />
      {v.settings.licences.supplier && (
        <Card className="mb-6" data-testid="ex-auth">
          <CardHeader><CardTitle>{l.authTitle}</CardTitle><CardDescription>{l.authIntro}</CardDescription></CardHeader>
          <CardContent><Link href="/vendor/company/compliance" className="text-sm text-primary hover:underline">{l.authLink}</Link></CardContent>
        </Card>
      )}
      {!v.settings.duty.calculate && <p className="mb-4 text-sm text-muted-foreground">{l.calcOff}</p>}
      <Card>
        <CardContent className="pt-2">
          {!v.offers.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.noProducts}</p> : (
            <ul className="divide-y" data-testid="ex-offers">
              {v.offers.map((o) => (
                <li key={o.offerId} className="space-y-2 py-4 text-sm" data-testid="ex-offer" data-offer={o.offerId}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 basis-56 break-words font-medium">{o.name} <span className="text-xs font-normal text-muted-foreground">· {o.sku}</span></span>
                    <Badge variant="outline">{o.category}</Badge>
                    {o.missing.length > 0 ? <Badge variant="destructive" data-testid="ex-missing">{fill(l.missing, { fields: o.missing.map((m) => l[`field.${m}`] ?? m).join(", ") })}</Badge>
                      : o.dutyUnit != null ? <Badge variant="secondary" data-testid="ex-duty">{fill(l.dutyUnit, { amount: formatMoney(o.dutyUnit, locale) })}</Badge>
                      : <Badge variant="outline">{l.noRate}</Badge>}
                  </div>
                  {edit && <OfferExciseForm l={l} row={o} categories={v.categories} calculate={v.settings.duty.calculate} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
