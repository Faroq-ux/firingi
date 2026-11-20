import { Leaf } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { supplierCo2 } from "@/server/co2/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { co2Labels, fill, kgText } from "@/components/co2/labels";
import { OfferCo2Form } from "@/components/co2/client";

export const metadata = { title: "CO₂ & Packaging" };
export const dynamic = "force-dynamic";

export default async function VendorCo2Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.products.manage", "vendor.pricing.manage"]);
  const { q } = await searchParams;
  const { l, locale } = await co2Labels();
  const d = await supplierCo2(ctx, locale);
  const rows = q ? d.rows.filter((r) => `${r.label} ${r.sku}`.toLowerCase().includes(q.toLowerCase())) : d.rows;
  const tone = (s: string) => (s === "APPROVED" ? "success" : s === "REJECTED" ? "destructive" : "warning") as "success" | "destructive" | "warning";
  return (
    <>
      <PageHeader title={l.vendorTitle} icon={Leaf} description={l.vendorIntro} />
      {!d.access.supplier && <p className="mb-4 rounded-xl border border-dashed p-4 text-sm" data-testid="co2-closed">{l[`closed.${d.access.why ?? "TYPE_OFF"}`] ?? l["closed.OFF"]}</p>}
      {d.grade?.grade && (
        <Card className="mb-6" data-testid="co2-grade"><CardContent className="flex flex-wrap items-center gap-4 pt-5">
          <span className="grid size-14 place-items-center rounded-2xl bg-[color-mix(in_oklch,var(--vivid-teal)_18%,transparent)] text-2xl font-bold text-[color:color-mix(in_oklch,var(--vivid-teal)_75%,var(--foreground))]">{d.grade.grade}</span>
          <div className="min-w-0 flex-1 text-sm"><p className="font-medium">{fill(l.gradeLine, { score: d.grade.score })}</p><p className="text-muted-foreground">{l.gradeHint}</p></div>
        </CardContent></Card>
      )}
      <Card>
        <CardHeader><CardTitle>{l.valuesTitle}</CardTitle><CardDescription>{d.settings.approval === "AUTO" ? l.valuesAuto : l.valuesChecked}</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <form method="get" className="max-w-sm"><input name="q" defaultValue={q ?? ""} placeholder={l.searchProducts} aria-label={l.searchProducts} className="h-9 w-full rounded-lg border bg-transparent px-3 text-sm" /></form>
          {!rows.length ? <p className="py-6 text-center text-sm text-muted-foreground">{l.noProducts}</p> : (
            <ul className="divide-y" data-testid="co2-offers">
              {rows.slice(0, 200).map((r) => (
                <li key={r.offerId} className="space-y-2 py-3 text-sm" data-testid="co2-offer" data-offer={r.offerId}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 break-words font-medium">{r.label} <span className="text-xs font-normal text-muted-foreground">{r.sku}</span></span>
                    <span className="text-xs text-muted-foreground">{fill(l.nowUsed, { value: kgText(r.kgPerKg, locale), pack: kgText(r.perPack, locale) })}</span>
                    {r.mine && <Badge variant={tone(r.mine.status)} data-testid="co2-status">{l[`status.${r.mine.status}`]}</Badge>}
                  </div>
                  {r.mine?.status === "REJECTED" && r.mine.reviewNote && <p className="text-xs text-destructive">{fill(l.firingiNote, { note: r.mine.reviewNote })}</p>}
                  {d.access.supplier && <OfferCo2Form l={l} offerId={r.offerId} categoryKgPerKg={r.categoryKgPerKg} initial={r.mine ? { kgPerKg: r.mine.kgPerKg, packaging: r.mine.packaging, recyclable: r.mine.recyclable, source: r.mine.source } : null} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
