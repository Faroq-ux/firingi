import Link from "next/link";
import { Barcode } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { codesPage } from "@/server/trade/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryCnRow, ProductCustomsForm, ProposalReview } from "@/components/trade/admin";
import { ProblemBadges } from "@/components/trade/views";

export const metadata = { title: "Customs Codes (CN8)" };
export const dynamic = "force-dynamic";

export default async function EuTradeCodesPage({ searchParams }: { searchParams: Promise<{ q?: string; missing?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.manage", "admin.tax.manage", "admin.finance.view", "admin.finance.manage", "admin.invoices.view"]);
  const f = await searchParams;
  const d = await codesPage(ctx, { q: f.q, missing: f.missing === "1" });
  const edit = can(ctx, ["admin.catalogue.manage", "admin.tax.manage"]);
  return (
    <>
      <PageHeader title="Customs Codes (CN8)" icon={Barcode} description="The 8-digit Combined Nomenclature code, net mass, supplementary units and country of origin Intrastat needs — a default per category, the exact values per product from FIRINGI or the supplier, checked here." />
      <Card className="mb-6">
        <CardHeader><CardTitle>From suppliers — to check ({d.pending.length})</CardTitle><CardDescription>Accept copies the values to the product (you can correct them first); reject tells the supplier why.</CardDescription></CardHeader>
        <CardContent>
          {!d.pending.length ? <p className="text-sm text-muted-foreground">Nothing to check.</p> : (
            <ul className="divide-y" data-testid="trade-proposals">
              {d.pending.map((p) => (
                <li key={p.id} className="space-y-2 py-3">
                  <p className="text-sm"><span className="font-medium">{p.product}</span>{p.pack ? ` · ${p.pack}` : ""} <span className="text-muted-foreground">— {p.company}, {p.createdAt.slice(0, 10)}</span></p>
                  <p className="text-xs text-muted-foreground">Now: CN8 {p.current.cn ?? "—"} (category {p.current.categoryCn ?? "—"}) · origin {p.current.origin ?? "—"} · net {p.current.netKg ?? "—"} kg · suppl. {p.current.supp ?? "—"}{p.note ? ` · supplier's note: ${p.note}` : ""}</p>
                  {edit ? <ProposalReview p={p} /> : <p className="text-sm">CN8 {p.cn ?? "—"} · {p.netKg ?? "—"} kg · origin {p.origin ?? "—"}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card className="mb-6">
        <CardHeader><CardTitle>Products in cross-border returns</CardTitle><CardDescription>Products on lines of open returns. <Link className="underline" href={f.missing === "1" ? "?" : "?missing=1"}>{f.missing === "1" ? "Show all" : "Only those missing data"}</Link></CardDescription></CardHeader>
        <CardContent>
          <form className="mb-3"><input name="q" defaultValue={f.q ?? ""} placeholder="Search products" className="w-full max-w-sm rounded-md border px-3 py-1.5 text-sm" />{f.missing === "1" && <input type="hidden" name="missing" value="1" />}</form>
          {!d.products.length ? <p className="text-sm text-muted-foreground">No products in cross-border returns{f.missing === "1" ? " with missing data" : ""}.</p> : (
            <ul className="divide-y" data-testid="trade-products">
              {d.products.map((p) => (
                <li key={p.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{p.name}</span><span className="text-muted-foreground">{p.category}</span>{p.categoryCn && <span className="text-xs text-muted-foreground">category default {p.categoryCn}</span>}{p.checkedAt && <span className="text-xs text-muted-foreground">checked {p.checkedAt.slice(0, 10)}</span>}<ProblemBadges problems={p.missing} /></div>
                  {edit && <ProductCustomsForm id={p.id} cn={p.cn} origin={p.origin} suppUnit={p.suppUnit} packs={p.packs} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Category defaults</CardTitle><CardDescription>Used for a product without its own code (sub-categories inherit). The line is flagged &quot;category&apos;s default&quot; so it can be confirmed.</CardDescription></CardHeader>
        <CardContent>
          <ul className="divide-y text-sm" data-testid="trade-categories">
            {d.categories.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5" style={{ paddingLeft: c.depth * 18 }}>
                <span className="min-w-0 flex-1 basis-48 break-words">{c.name}</span>
                {edit ? <CategoryCnRow id={c.id} cn={c.cn} suppUnit={c.suppUnit} /> : <span className="font-mono">{c.cn ?? "—"}</span>}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
