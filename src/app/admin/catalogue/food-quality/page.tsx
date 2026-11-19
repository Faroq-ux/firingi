import Link from "next/link";
import { Gauge } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { foodCategories, qualityDashboard } from "@/server/food/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RequirementsRow } from "@/components/food/client";

export const metadata = { title: "Food Data Quality" };
export const dynamic = "force-dynamic";
const word = (x: string) => x.toLowerCase().replace(/_/g, " ");
const Bar = ({ pct }: { pct: number }) => <span className="inline-flex items-center gap-2"><span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"><span className={`block h-full ${pct === 100 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-destructive"}`} style={{ width: `${pct}%` }} /></span><span className="tabular-nums text-xs">{pct}%</span></span>;

/** Phase 44: completeness per supplier and category, missing products, expiring certificates, recipe changes, requirements per category. */
export default async function FoodQualityPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.approve"]);
  const [q, cats] = await Promise.all([qualityDashboard(ctx), foodCategories(ctx)]);
  const manage = can(ctx, "admin.catalogue.manage");
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
  const tiles = [["Food products", q.tiles.food], ["Complete", `${q.tiles.complete} (${q.tiles.completePct}%)`], ["Missing data", q.tiles.missing], ["Waiting for review", q.tiles.pending], [q.settings.requireToSell ? "Hidden now" : "Would be hidden", q.settings.requireToSell ? q.tiles.blockedNow : q.tiles.wouldBlock], ["Certificates ≤ 60 days", q.tiles.expiringCerts]] as const;
  return (
    <>
      <PageHeader title="Food Data Quality" icon={Gauge} description="How complete the food information is, per supplier and category; what is missing; certificates expiring; recipe changes customers were told about; and what each category requires." />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="food-quality-tiles">
        {tiles.map(([k, v]) => <div key={k} className="glass-panel rounded-2xl border p-3"><div className="text-xl font-bold tabular-nums">{v}</div><div className="text-xs text-muted-foreground">{k}</div></div>)}
      </div>
      {!q.settings.requireToSell && q.tiles.wouldBlock > 0 && <p className="mb-4 text-sm text-amber-700 dark:text-amber-400" data-testid="food-would-block">If you switch on “required to sell” (Settings › Food Information), {q.tiles.wouldBlock} food products would be hidden from customers until their information is approved.</p>}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Suppliers</CardTitle></CardHeader><CardContent>
          {!q.suppliers.length ? <p className="text-sm text-muted-foreground">—</p> : <ul className="divide-y text-sm" data-testid="food-quality-suppliers">{q.suppliers.map((s) => <li key={s.id} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1 basis-40 break-words">{s.name}</span><span className="text-xs text-muted-foreground">{s.complete}/{s.products}</span><Bar pct={s.pct} /></li>)}</ul>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Categories</CardTitle></CardHeader><CardContent>
          <ul className="divide-y text-sm">{q.categories.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1 basis-40 break-words">{c.name}</span><span className="text-xs text-muted-foreground">{c.complete}/{c.products}</span><Bar pct={c.pct} /></li>)}</ul>
        </CardContent></Card>
      </div>
      <Card className="mb-6"><CardHeader><CardTitle>Products missing food information</CardTitle></CardHeader><CardContent>
        {!q.missing.length ? <p className="text-sm text-muted-foreground">All complete.</p> : (
          <ul className="divide-y text-sm" data-testid="food-quality-missing">{q.missing.map((m) => (
            <li key={m.productId} className="flex flex-wrap items-center gap-2 py-2" data-testid="food-missing-row" data-product={m.productId}>
              <span className="min-w-0 flex-1 basis-56 break-words font-medium">{m.name} <span className="text-xs font-normal text-muted-foreground">· {m.category} · {m.suppliers || "no supplier"}</span></span>
              <span className="text-xs">{m.missing.map(word).join(", ")}</span>
              {m.pending && <Badge variant="warning">waiting for review</Badge>}
              {m.blocked && <Badge variant="destructive">hidden</Badge>}
            </li>
          ))}</ul>
        )}
      </CardContent></Card>
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Certificates expiring</CardTitle></CardHeader><CardContent>
          {!q.certificates.length ? <p className="text-sm text-muted-foreground">None in the next 60 days.</p> : <ul className="divide-y text-sm">{q.certificates.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1 basis-40 break-words">{c.product} <span className="text-xs text-muted-foreground">· {c.supplier}</span></span><Badge variant="outline">{word(c.diet)}</Badge><span className={`text-xs ${c.expired ? "text-destructive" : ""}`}>{day(c.expiresOn)}</span></li>)}</ul>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Recipe changes</CardTitle></CardHeader><CardContent>
          {!q.changes.length ? <p className="text-sm text-muted-foreground">None yet.</p> : <ul className="divide-y text-sm">{q.changes.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1 basis-40 break-words">{c.product}</span>{c.allergenAdded && <Badge variant="destructive">allergen added</Badge>}<span className="text-xs text-muted-foreground">{day(c.at)} · {c.notified} customers told</span></li>)}</ul>}
        </CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>What each category requires</CardTitle><CardDescription>Fields a product of the category needs before it counts as complete (and, with “required to sell”, before customers see it). Subcategories inherit from their parent unless they have their own rule; a top category without a rule is not food.</CardDescription></CardHeader><CardContent>
        <ul className="divide-y text-sm" data-testid="food-requirements">{cats.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 py-2" style={{ paddingLeft: `${c.depth * 1.25}rem` }}>
            <span className="min-w-0 flex-1 basis-48 break-words">{c.name} <span className="text-xs text-muted-foreground">· {c.effective === null ? "not food" : c.effective.length ? c.effective.map(word).join(", ") : "nothing required"}{c.inherited && c.effective !== null ? " (from parent)" : ""}</span></span>
            {manage && <RequirementsRow categoryId={c.id} own={c.own} effective={c.effective} inherited={c.inherited} />}
          </li>
        ))}</ul>
        <p className="mt-3 text-xs text-muted-foreground">See also <Link href="/admin/catalogue/food-review" className="text-primary hover:underline">Food Info Review</Link> · <Link href="/admin/settings/food" className="text-primary hover:underline">Settings</Link></p>
      </CardContent></Card>
    </>
  );
}
