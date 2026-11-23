import { notFound } from "next/navigation";
import { Scale } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { benchAccess, supplierPosition } from "@/server/benchmark/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { benchLabels } from "@/components/benchmark/labels";
import { RangeBar, fill, unitEur } from "@/components/benchmark/views";

export const metadata = { title: "Price Position" };
export const dynamic = "force-dynamic";
const tone = { ABOVE: "warning", AROUND: "secondary", BELOW: "success" } as const;

/** Phase 70: a supplier's list prices against what buyers pay for the same products (no other supplier named). */
export default async function PricePositionPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.reports.view", "vendor.products.manage"]);
  if (!(await benchAccess(ctx.company)).supplier) notFound();
  const { l, locale } = await benchLabels();
  const rows = await supplierPosition(ctx, locale);
  return (
    <>
      <PageHeader title={l.vTitle} description={l.vIntro} icon={Scale} />
      <Card>
        <CardContent className="pt-6">
          {!rows.length ? <p className="text-sm text-muted-foreground">{l.vNone}</p> : (
            <ul className="divide-y" data-testid="bm-v-rows">
              {rows.map((r) => (
                <li key={r.offerId} className="space-y-2 py-3" data-testid="bm-v-row" data-band={r.band ?? "NONE"}>
                  <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 basis-56 break-words font-medium">{r.product} <span className="text-xs font-normal text-muted-foreground">{r.pack} · {r.sku}</span></span>{r.band && <Badge variant={tone[r.band]}>{l[`vBand.${r.band}`]}</Badge>}</div>
                  {r.stats ? (
                    <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                      <div className="text-sm"><p>{l.yourListPrice}: <span className="font-semibold tabular-nums">{unitEur(locale, r.unitPrice)}</span></p><p className="text-xs text-muted-foreground">{l.buyersPay}: {unitEur(locale, r.stats.p50)} · {fill(l.range, { low: unitEur(locale, r.stats.p25), high: unitEur(locale, r.stats.p75) })} · {fill(l.buyers, { n: r.buyers })}</p>{r.position !== null && <p className="text-xs text-muted-foreground">{fill(l.vPosition, { pct: r.position })}</p>}</div>
                      <RangeBar s={r.stats} value={r.unitPrice} tone="neutral" label={`${l.yourListPrice} ${unitEur(locale, r.unitPrice)}; ${l.buyersPay} ${unitEur(locale, r.stats.p50)}`} />
                    </div>
                  ) : <p className="text-xs text-muted-foreground">{l.yourListPrice}: {unitEur(locale, r.unitPrice)} · {l.noBench}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
