import { Wine } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listCategories, listLicenceTypes, shopCategories } from "@/server/excise/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExciseCategoryForm, LicenceTypeForm, RateForm, ShopCategoryExcise } from "@/components/excise/client";

export const metadata = { title: "Excise Categories" };
export const dynamic = "force-dynamic";

const BASIS: Record<string, string> = {
  HL_PURE_ALCOHOL: "€ per hl of pure alcohol", HL_PER_ABV: "€ per hl per % vol", HL_PRODUCT: "€ per hl", THOUSAND_UNITS: "€ per 1000 pieces (+ % of price)", KG: "€ per kg (+ % of price)", ML: "€ per ml", HL_SUGAR_BAND: "€ per hl by sugar band",
};

export default async function ExciseCataloguePage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.manage"]);
  const [cats, shop, types] = await Promise.all([listCategories(), shopCategories(), listLicenceTypes()]);
  const edit = can(ctx, "admin.catalogue.manage");
  const opts = cats.map((c) => ({ id: c.id, name: c.name }));
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "…");
  return (
    <>
      <PageHeader title="Excise Categories & Rates" icon={Wine} description="The excise categories, their duty rates per buyer country (history kept), caps and blocked countries; which shop categories fall in each; the licence types customers need." />
      <div className="space-y-6">
        {cats.map((c) => (
          <Card key={c.id} data-testid="ex-cat" data-code={c.code}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">{c.name} <Badge variant="outline">{c.kind.toLowerCase()}</Badge>{!c.active && <Badge variant="destructive">off</Badge>}</CardTitle>
              <CardDescription>{BASIS[c.basis]} · {c.shopCategories} shop categories · {c.offers} products chosen by suppliers</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <ul className="divide-y" data-testid="ex-rates">
                {c.rates.map((r) => (
                  <li key={r.id} className={`flex flex-wrap items-center gap-2 py-1.5 ${r.current ? "" : "text-muted-foreground line-through"}`} data-testid="ex-rate" data-country={r.countryCode}>
                    <span className="w-8 font-mono">{r.countryCode}</span>
                    <span className="tabular-nums">{c.basis === "HL_SUGAR_BAND" ? r.bands.map((b) => `${b.maxGPerL == null ? "rest" : `< ${b.maxGPerL} g/l`}: ${b.perHl} €`).join(" · ") : `${r.rate} €${r.adValoremPct != null ? ` + ${r.adValoremPct} %` : ""}`}</span>
                    <span className="text-xs text-muted-foreground">{day(r.validFrom)} → {day(r.validTo)}{r.note ? ` · ${r.note}` : ""}</span>
                  </li>
                ))}
                {!c.rates.length && <li className="py-1.5 text-muted-foreground">No rates yet.</li>}
              </ul>
              {edit && <RateForm categoryId={c.id} sugar={c.basis === "HL_SUGAR_BAND"} tobacco={c.basis === "THOUSAND_UNITS" || c.basis === "KG"} />}
              {edit && <ExciseCategoryForm c={c} />}
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader><CardTitle>Shop categories</CardTitle><CardDescription>Products in a category get its excise category (children inherit); suppliers can choose another per product.</CardDescription></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" data-testid="ex-shop-cats">
              {shop.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 py-1.5" style={{ paddingLeft: `${s.depth * 16}px` }}>
                  <span className="min-w-0 flex-1 basis-40 break-words">{s.name}</span>
                  {edit ? <ShopCategoryExcise categoryId={s.id} value={s.exciseCategoryId} inherited={s.inherited} options={opts} /> : <span className="text-muted-foreground">{opts.find((o) => o.id === (s.exciseCategoryId ?? s.inherited))?.name ?? "—"}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Licence types</CardTitle><CardDescription>What customers upload; each covers some kinds of goods, in some countries (empty = all).</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {types.map((t) => (
              <div key={t.id} className="space-y-1 border-b pb-3 text-sm last:border-0">
                <p className="font-medium">{t.name} <span className="text-xs font-normal text-muted-foreground">· {t.code} · {t.kinds.join(", ").toLowerCase()} · {t.countries.join(" ") || "all countries"} · {t.licences} uploaded</span></p>
                {edit && <LicenceTypeForm t={t} />}
              </div>
            ))}
            {edit && <div className="pt-2"><p className="mb-2 text-sm font-medium">New licence type</p><LicenceTypeForm /></div>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
