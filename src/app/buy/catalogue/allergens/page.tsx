import Link from "next/link";
import { BookOpen, Download, QrCode, ShieldAlert } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { foodSettings, myFoodProducts, myProfile, myRecipeChanges } from "@/server/food/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FoodProfileForm } from "@/components/food/client";
import { RecipeChanges } from "@/components/food/views";
import { foodLabels } from "@/components/food/labels";
import { ALLERGENS } from "@/lib/food";

export const metadata = { title: "Allergens & Food Info" };

/** Contains = red dot, may contain = amber half dot, free = dash, not stated = ? (drawn, not font glyphs). */
function Mark({ lv }: { lv?: string | null }) {
  if (lv === "CONTAINS") return <span aria-hidden className="inline-block size-2.5 rounded-full bg-red-600 dark:bg-red-400" />;
  if (lv === "MAY_CONTAIN") return <span aria-hidden className="inline-block size-2.5 rounded-full border-2 border-amber-500 bg-[linear-gradient(90deg,var(--color-amber-500)_50%,transparent_50%)]" />;
  if (lv === "FREE") return <span aria-hidden>–</span>;
  return <span aria-hidden>?</span>;
}
export const dynamic = "force-dynamic";

/** Phase 44: the food information of what the customer buys — for its guests and shoppers — and recipe changes. */
export default async function BuyerAllergensPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.catalogue.view");
  const { l, locale } = await foodLabels();
  const [s, products, changes, profile] = await Promise.all([foodSettings(), myFoodProducts(ctx, locale), myRecipeChanges(ctx, locale), myProfile(ctx)]);
  const tiles = [
    s.sheet ? { href: "/api/food/book", icon: BookOpen, title: l.book, hint: l.bookHint, id: "food-book" } : null,
    s.publicPage ? { href: "/api/food/labels", icon: QrCode, title: l.labels, hint: l.labelsHint, id: "food-labels" } : null,
    s.export ? { href: "/api/food/export", icon: Download, title: l.exportCsv, hint: l.exportHint, id: "food-export" } : null,
  ].filter(Boolean) as { href: string; icon: typeof BookOpen; title: string; hint: string; id: string }[];
  return (
    <>
      <PageHeader title={l.pageTitle} icon={ShieldAlert} description={l.pageIntro} />
      {tiles.length > 0 && (
        <div className="mb-6 grid gap-3 md:grid-cols-3">
          {tiles.map((t) => (
            <a key={t.id} href={t.href} className="glass-panel motion-lift flex gap-3 rounded-2xl border p-4" data-testid={t.id} target={t.id === "food-export" ? undefined : "_blank"} rel="noreferrer">
              <t.icon className="mt-0.5 size-5 shrink-0 text-primary" />
              <span className="min-w-0"><span className="block font-medium">{t.title}</span><span className="block text-xs text-muted-foreground">{t.hint}</span></span>
            </a>
          ))}
        </div>
      )}
      {s.changeAlerts && (
        <Card className="mb-6">
          <CardHeader><CardTitle>{l.changesTitle}</CardTitle></CardHeader>
          <CardContent><RecipeChanges rows={changes} l={l} locale={locale} /></CardContent>
        </Card>
      )}
      {profile && (
        <Card className="mb-6">
          <CardHeader><CardTitle>{l.profileTitle}</CardTitle><CardDescription>{l.profileIntro}</CardDescription></CardHeader>
          <CardContent><FoodProfileForm l={l} initial={profile} /></CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>{l.productsTitle}</CardTitle></CardHeader>
        <CardContent>
          {!products.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.noProducts}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm" data-testid="food-matrix">
                <thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 pr-2 text-left">{l.product}</th>{ALLERGENS.map((a) => <th key={a} className="px-1 text-center font-normal" title={l[`a.${a}`]}><span className="inline-block max-w-[4.5rem] truncate align-bottom">{l[`a.${a}`]}</span></th>)}<th /></tr></thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.productId} className="border-b" data-testid="food-matrix-row" data-product={p.productId}>
                      <td className="py-2 pr-2"><span className="font-medium">{p.name}</span> <span className="text-xs text-muted-foreground">· {p.sku}</span></td>
                      {ALLERGENS.map((a) => { const lv = p.data?.allergens[a]; return <td key={a} className="px-1 text-center text-muted-foreground" title={lv ? l[`level.${lv}`] : l.notStated} data-level={lv ?? ""}><Mark lv={lv} /></td>; })}
                      <td className="pl-2 text-right">{s.publicPage && p.approved && <Link href={`/food/${p.productId}`} target="_blank" className="text-xs text-primary hover:underline">{l.publicPage}</Link>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><Mark lv="CONTAINS" /> {l["level.CONTAINS"]}</span><span className="inline-flex items-center gap-1"><Mark lv="MAY_CONTAIN" /> {l["level.MAY_CONTAIN"]}</span><span className="inline-flex items-center gap-1"><Mark lv="FREE" /> {l["level.FREE"]}</span><span className="inline-flex items-center gap-1"><Mark /> {l.notStated}</span></p>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
