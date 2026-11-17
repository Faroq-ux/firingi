import { Scale } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { vendorCatchWeightOffers } from "@/server/catchweight/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OfferCwForm } from "@/components/catchweight/client";
import { cwLabels, fill } from "@/components/catchweight/labels";

export const metadata = { title: "Sold by Weight" };
export const dynamic = "force-dynamic";

export default async function VendorWeightsPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.products.manage", "vendor.products.view"]);
  const { l, locale } = await cwLabels();
  const v = await vendorCatchWeightOffers(ctx, locale);
  const edit = can(ctx, "vendor.products.manage");
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  const offers = [...v.offers].sort((a, b) => Number(!!b.mode) - Number(!!a.mode));
  return (
    <>
      <PageHeader title={l.productsTitle} icon={Scale} description={l.productsIntro} />
      <p className="mb-1 text-sm text-muted-foreground" data-testid="cw-limit">{fill(l.productsLimit, { pct: v.settings.maxOverPct })}</p>
      <p className="mb-4 text-sm text-muted-foreground">{fill(l.labelsInfo, { prefixes: v.settings.prefixes.join(" / "), digits: v.settings.itemDigits })}</p>
      <Card>
        <CardContent className="pt-2">
          {!offers.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.noProducts}</p> : (
            <ul className="divide-y" data-testid="cw-offers">
              {offers.map((o) => (
                <li key={o.id} className="py-1">
                  <details open={offers.length <= 3 || undefined} className="group">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 py-2 text-sm" data-testid="cw-offer-row" data-offer={o.id}>
                      <span className="min-w-0 flex-1 basis-48 break-words font-medium">{o.name} <span className="text-xs font-normal text-muted-foreground">· {o.packaging}{o.sku ? ` · ${o.sku}` : ""}</span></span>
                      {o.mode ? <Badge variant="secondary" className="gap-1"><Scale className="size-3" /> {o.mode === "PIECE" ? l.modePiece : l.modeKg}{o.perKg != null ? ` · ${fill(l.perKgShort, { price: money(o.perKg) })}` : ""}</Badge> : <Badge variant="outline">{l.modeNone}</Badge>}
                    </summary>
                    {edit && <div className="pb-4"><OfferCwForm l={l} locale={locale} o={o} limit={v.settings.maxOverPct} /></div>}
                  </details>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
