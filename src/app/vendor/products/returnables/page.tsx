import { Recycle } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listTypes, vendorOfferLinks } from "@/server/returnables/service";
import { RETURNABLE_CATEGORIES } from "@/lib/returnables";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkForm, TypeForm, UnlinkButton } from "@/components/returnables/client";
import { fill, rtLabels } from "@/components/returnables/labels";

export const metadata = { title: "Returnables" };
export const dynamic = "force-dynamic";

export default async function VendorReturnablesPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.products.manage", "vendor.products.view"]);
  const { l, locale } = await rtLabels();
  const [types, offers] = await Promise.all([listTypes(ctx, locale), vendorOfferLinks(ctx, locale)]);
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  const active = types.filter((t) => t.active);
  const linked = offers.filter((o) => o.links.length);
  return (
    <>
      <PageHeader title={l.itemsTitle} icon={Recycle} description={l.itemsIntro} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{l.itemsList}</CardTitle><CardDescription>{l.itemsListHint}</CardDescription></CardHeader>
          <CardContent>
            <ul className="divide-y" data-testid="types">
              {active.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="type-row" data-code={t.code}>
                  <span className="min-w-0 flex-1 break-words font-medium">{t.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{t.code}</span>
                  <Badge variant={t.kind === "EXCHANGE" ? "secondary" : "outline"}>{l[`kind.${t.kind}`]}</Badge>
                  <span className="tabular-nums">{money(t.depositNet)}</span>
                  <Badge variant="outline">{t.shared ? "FIRINGI" : l.yours}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{l.addOwnItem}</CardTitle><CardDescription>{l.addOwnItemHint}</CardDescription></CardHeader>
          <CardContent><TypeForm l={l} categories={RETURNABLE_CATEGORIES} /></CardContent>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader><CardTitle>{l.linksTitle}</CardTitle><CardDescription>{l.linksHint}</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <LinkForm l={l} offers={offers.map((o) => ({ id: o.offerId, label: `${o.product} · ${o.packaging} (${o.sku})` }))} types={active.map((t) => ({ id: t.id, label: `${t.name} · ${money(t.depositNet)} · ${l[`kind.${t.kind}`]}` }))} />
          {!linked.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.noLinks}</p> : (
            <ul className="divide-y" data-testid="links">
              {linked.map((o) => (
                <li key={o.offerId} className="space-y-1 py-2 text-sm" data-testid="link-row">
                  <p className="break-words font-medium">{o.product} · {o.packaging} <span className="font-mono text-xs text-muted-foreground">{o.sku}</span></p>
                  <ul className="flex flex-wrap gap-2">
                    {o.links.map((k) => (
                      <li key={k.typeId} className="flex items-center gap-1 rounded-lg border px-2 py-0.5" data-testid="link-chip" data-code={k.code}>
                        {fill(l.perUnitLine, { n: k.qtyPerUnit, name: k.name })} · {money(k.depositNet)}
                        <UnlinkButton l={l} offerId={o.offerId} typeId={k.typeId} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
