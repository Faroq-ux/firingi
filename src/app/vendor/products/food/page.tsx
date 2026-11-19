import Link from "next/link";
import { Apple, FileUp } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { supplierFoodList } from "@/server/food/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { foodLabels, fill } from "@/components/food/labels";

export const metadata = { title: "Food Information" };
export const dynamic = "force-dynamic";

/** Phase 44: the supplier's food products — what each needs, how complete, FIRINGI's status. */
export default async function VendorFoodPage({ searchParams }: { searchParams: Promise<{ show?: string; q?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.products.manage", "vendor.products.view"]);
  const sp = await searchParams;
  const { l, locale } = await foodLabels();
  const v = await supplierFoodList(ctx, { q: sp.q, show: sp.show === "todo" ? "todo" : "all" }, locale);
  const fields = (fs: string[]) => fs.map((x) => l[`field.${x}`] ?? x).join(", ");
  const tiles = [[l.tProducts, v.totals.products], [l.tComplete, v.totals.complete], [l.tPending, v.totals.pending], [l.tHidden, v.totals.blocked]] as const;
  return (
    <>
      <PageHeader title={l.title} icon={Apple} description={l.intro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="food-tiles">
        {tiles.map(([k, n]) => <div key={k} className="glass-panel rounded-2xl border p-3"><div className="text-2xl font-bold tabular-nums">{n}</div><div className="text-xs text-muted-foreground">{k}</div></div>)}
      </div>
      {v.settings.requireToSell && <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">{l.requireNote}</p>}
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <Link href="?show=all" className={sp.show !== "todo" ? "font-semibold underline" : "text-primary hover:underline"}>{l.all}</Link>
        <Link href="?show=todo" className={sp.show === "todo" ? "font-semibold underline" : "text-primary hover:underline"} data-testid="food-todo">{l.onlyTodo}</Link>
        {v.settings.import && <Link href="/vendor/products/food/import" className="ml-auto inline-flex items-center gap-1 text-primary hover:underline" data-testid="food-import-link"><FileUp className="size-4" /> {l.importLink}</Link>}
      </div>
      <Card>
        <CardContent className="pt-2">
          {!v.rows.length ? <p className="py-6 text-center text-sm text-muted-foreground">{l.noRows}</p> : (
            <ul className="divide-y" data-testid="food-rows">
              {v.rows.map((r) => (
                <li key={r.productId} className="flex flex-wrap items-center gap-2 py-3 text-sm" data-testid="food-row" data-product={r.productId} data-score={r.score}>
                  <Link href={`/vendor/products/food/${r.productId}`} className="min-w-0 flex-1 basis-56 break-words font-medium text-primary hover:underline">{r.name} <span className="text-xs font-normal text-muted-foreground">· {r.sku}</span></Link>
                  <span className="flex items-center gap-2"><span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><span className={`block h-full ${r.score === 100 ? "bg-emerald-500" : r.score >= 50 ? "bg-amber-500" : "bg-destructive"}`} style={{ width: `${r.score}%` }} /></span><span className="tabular-nums text-xs">{r.score}%</span></span>
                  {r.mine && <Badge variant={r.mine.status === "REJECTED" ? "destructive" : r.mine.status === "PENDING" ? "warning" : "outline"} data-testid="food-row-status">{l[`status.${r.mine.status}`]}</Badge>}
                  {!r.mine && r.approved && <Badge variant="success">{l["status.APPROVED"]}</Badge>}
                  {r.missing.length > 0 && <span className="w-full text-xs text-muted-foreground sm:w-auto">{fill(l.missing, { fields: fields(r.missing) })}</span>}
                  {r.blocked && <Badge variant="destructive">{l.hidden}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
