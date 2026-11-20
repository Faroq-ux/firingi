/** Menu costing & food waste (Phase 54) — the buyer portal's Kitchen pages (server-rendered). */
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChefHat, Flame, Gift, Leaf, LineChart, Package, Recycle, Soup, Trash2, TriangleAlert } from "lucide-react";
import type { Ctx } from "@/server/context";
import { AppError, NotFoundError } from "@/server/errors";
import * as K from "@/server/kitchen/service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { dateText, eur, fill, kitchenLabels, pct, qtyText } from "./labels";
import { AddFromPurchase, DeleteButton, IngredientForm, ProfileForm, RecipeEditor, SimpleAction, WasteLogger, WhatIf } from "./client";

type L = Record<string, string>;
const B = "/buy/kitchen";

function Closed({ l, title, icon }: { l: L; title: string; icon: typeof ChefHat }) {
  return (
    <>
      <PageHeader title={title} icon={icon} />
      <p className="py-10 text-center text-muted-foreground" data-testid="kitchen-closed">{l.closed}</p>
    </>
  );
}

/** Runs a page's loader; FIRINGI switched off / no right → the "not available" page. */
async function load<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof AppError && (e.code === "KITCHEN_OFF" || e.code === "KITCHEN_PART_OFF" || e.code === "FORBIDDEN")) return null;
    throw e;
  }
}

const tile = (label: string, value: string, opts: { testid?: string; tone?: "warn" | "ok"; href?: string } = {}) => (
  <Card><CardContent className="pt-5">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={`text-2xl font-semibold tabular-nums ${opts.tone === "warn" ? "text-destructive" : opts.tone === "ok" ? "text-[color:var(--success,#16a34a)]" : ""}`} data-testid={opts.testid}>{opts.href ? <Link href={opts.href} className="hover:underline">{value}</Link> : value}</p>
  </CardContent></Card>
);

const allergenText = (codes: string[], l: L) => {
  const has = new Set(codes.filter((c) => !c.startsWith("~")));
  const may = codes.filter((c) => c.startsWith("~") && !has.has(c.slice(1))).map((c) => c.slice(1));
  return { has: [...has].map((c) => l[`allergen.${c}`] ?? c), may: may.map((c) => l[`allergen.${c}`] ?? c) };
};

function Allergens({ codes, l }: { codes: string[]; l: L }) {
  const a = allergenText(codes, l);
  if (!a.has.length && !a.may.length) return <span className="text-xs text-muted-foreground">{l.noAllergens}</span>;
  return (
    <span className="flex flex-wrap gap-1" data-testid="dish-allergens">
      {a.has.map((x) => <Badge key={x} variant="warning">{x}</Badge>)}
      {a.may.map((x) => <Badge key={x} variant="secondary">{fill(l.mayContain, { x })}</Badge>)}
    </span>
  );
}

// ── overview ────────────────────────────────────────────────────────────────

export async function KitchenOverviewView({ ctx }: { ctx: Ctx }) {
  const { l, locale } = await kitchenLabels();
  const o = await K.kitchenOverview(ctx, locale);
  if (!o.on) return <Closed l={l} title={l.overviewTitle} icon={ChefHat} />;
  const prof = o.manage && o.parts.costing ? await K.kitchenProfile(ctx.company.id) : null;
  const s = await K.kitchenSettings();
  return (
    <>
      <PageHeader title={l.overviewTitle} icon={ChefHat} description={l.overviewIntro} />
      {o.manage ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="kitchen-tiles">
            {tile(l.ingredients, String(o.ingredients), { href: `${B}/ingredients` })}
            {tile(l.dishes, String(o.dishes), { href: `${B}/recipes` })}
            {tile(l.avgFoodCost, pct(o.avgFoodCostPct, locale), { testid: "avg-food-cost", tone: o.avgFoodCostPct != null && o.target != null ? (o.avgFoodCostPct > o.target ? "warn" : "ok") : undefined })}
            {o.waste && tile(l.waste30, eur(o.waste.cost, locale), { testid: "waste-30", href: `${B}/waste/reports` })}
            {o.waste && tile(l.wastePct, pct(o.waste.pct, locale), { tone: o.waste.over ? "warn" : "ok" })}
            {tile(l.useFirstTile, String(o.useFirst), { href: `${B}/use-first`, tone: o.useFirst ? "warn" : undefined })}
          </div>
          {o.ingredients === 0 && (
            <Card><CardContent className="space-y-2 pt-5 text-sm" data-testid="kitchen-start">
              <p className="font-medium">{l.startTitle}</p>
              <ol className="list-decimal space-y-1 pl-5 text-muted-foreground"><li>{l.start1}</li><li>{l.start2}</li><li>{l.start3}</li></ol>
              <div className="flex flex-wrap gap-2 pt-1"><Link href={`${B}/ingredients`} className="text-primary hover:underline">{l.ingredients} →</Link><SimpleAction l={l} what="import" label={l.importFromTill} testid="import-till" /></div>
            </CardContent></Card>
          )}
          {o.over.length > 0 && (
            <Card data-testid="over-target"><CardHeader><CardTitle className="flex items-center gap-2"><TriangleAlert className="size-5 text-destructive" aria-hidden /> {fill(l.overTargetTitle, { target: pct(o.target, locale) })}</CardTitle></CardHeader>
              <CardContent><ul className="divide-y text-sm">{o.over.map((d) => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><Link href={`${B}/recipes/${d.id}`} className="min-w-0 break-words font-medium hover:text-primary">{d.name}</Link><span className="tabular-nums text-destructive">{pct(d.pct, locale)}</span><span className="text-xs text-muted-foreground">{fill(l.suggestedIs, { price: eur(d.suggested, locale) })}</span></li>)}</ul></CardContent>
            </Card>
          )}
          {prof && (
            <Card><CardHeader><CardTitle>{l.targetsTitle}</CardTitle><CardDescription>{l.targetsIntro}</CardDescription></CardHeader>
              <CardContent><ProfileForm l={l} own={prof.own} defaults={{ targetFoodCostPct: s.targetFoodCostPct, wasteTargetPct: s.wasteTargetPct, costBasis: s.costBasis, rounding: s.rounding }} /></CardContent>
            </Card>
          )}
        </div>
      ) : (
        <Card><CardContent className="pt-5 text-sm"><p>{l.staffIntro}</p><Link href={`${B}/waste`} className="mt-2 inline-block text-primary hover:underline">{l.logWaste} →</Link></CardContent></Card>
      )}
    </>
  );
}

// ── ingredients ─────────────────────────────────────────────────────────────

export async function IngredientsView({ ctx }: { ctx: Ctx }) {
  const { l, locale } = await kitchenLabels();
  const data = await load(async () => ({ ings: await K.listIngredients(ctx), bought: await K.purchasedProducts(ctx, locale) }));
  if (!data) return <Closed l={l} title={l.ingredientsTitle} icon={Package} />;
  return (
    <>
      <PageHeader title={l.ingredientsTitle} icon={Package} description={l.ingredientsIntro} actions={<SimpleAction l={l} what="refresh" label={l.refreshCosts} testid="refresh-costs" />} />
      <div className="space-y-6">
        <Card data-testid="ingredient-list"><CardContent className="pt-5">
          {data.ings.length === 0 ? <p className="text-sm text-muted-foreground">{l.noIngredients}</p> : (
            <ul className="divide-y">{data.ings.map((i) => (
              <li key={i.id} className="space-y-2 py-3" data-testid="ingredient-row">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="min-w-0 break-words">{i.name}</b>
                  <Badge variant={i.source === "FIRINGI" ? "default" : "secondary"}>{l[`source.${i.source}`]}</Badge>
                  {!i.active && <Badge variant="outline">{l.inactive}</Badge>}
                  <span className="ml-auto text-sm tabular-nums" data-testid="ingredient-cost">{fill(l.perUnit, { cost: eur(i.cost, locale, 3), unit: l[`unit.${i.unit}`] })}</span>
                </div>
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{l[`basis.${i.costBasis ?? "MANUAL"}`]}{i.costAt ? ` · ${dateText(i.costAt, locale)}` : ""}</span>
                  {i.prevCost != null && i.cost != null && i.prevCost !== i.cost && <span className={i.cost > i.prevCost ? "text-destructive" : "text-[color:var(--success,#16a34a)]"}>{fill(l.wasCost, { cost: eur(i.prevCost, locale, 3) })}</span>}
                  {i.source === "FIRINGI" && i.packSize != null && <span>{fill(l.packIs, { n: qtyText(i.packSize, locale, 3), unit: l[`unit.${i.unit}`] })}</span>}
                  <span>{fill(l.yieldIs, { pct: qtyText(i.yieldPct, locale) })}</span>
                  {i.co2PerUnit != null && <span><Leaf className="inline size-3" aria-hidden /> {fill(l.co2Is, { kg: qtyText(i.co2PerUnit, locale), unit: l[`unit.${i.unit}`] })}</span>}
                  <span>{fill(l.usedIn, { n: i.usedIn })}</span>
                </p>
                <Allergens codes={i.allergens} l={l} />
                <details><summary className="cursor-pointer text-xs text-primary">{l.edit}</summary><div className="mt-2 flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><IngredientForm l={l} ing={i} /></div>{i.usedIn === 0 && <DeleteButton l={l} kind="ingredient" id={i.id} confirmText={l.deleteConfirm} />}</div></details>
              </li>
            ))}</ul>
          )}
        </CardContent></Card>
        {data.bought.length > 0 && (
          <Card data-testid="bought-list"><CardHeader><CardTitle>{l.boughtTitle}</CardTitle><CardDescription>{l.boughtIntro}</CardDescription></CardHeader>
            <CardContent><ul className="divide-y">{data.bought.slice(0, 40).map((p) => (
              <li key={p.productId} className="space-y-1 py-3" data-testid="bought-row">
                <p className="text-sm"><b>{p.name}</b> <span className="text-xs text-muted-foreground">· {p.pack} · {fill(l.lastPaid, { price: eur(p.lastPrice, locale), date: dateText(p.lastAt, locale) })}</span></p>
                <AddFromPurchase l={l} p={p} />
              </li>
            ))}</ul></CardContent>
          </Card>
        )}
        <Card><CardHeader><CardTitle>{l.manualTitle}</CardTitle><CardDescription>{l.manualIntro}</CardDescription></CardHeader><CardContent><IngredientForm l={l} /></CardContent></Card>
      </div>
    </>
  );
}

// ── recipes ─────────────────────────────────────────────────────────────────

export async function RecipesView({ ctx }: { ctx: Ctx }) {
  const { l, locale } = await kitchenLabels();
  const data = await load(() => K.listRecipes(ctx));
  if (!data) return <Closed l={l} title={l.recipesTitle} icon={Soup} />;
  const dishes = data.recipes.filter((r) => r.kind === "DISH"), subs = data.recipes.filter((r) => r.kind === "SUB");
  return (
    <>
      <PageHeader title={l.recipesTitle} icon={Soup} description={fill(l.recipesIntro, { target: pct(data.profile.targetFoodCostPct, locale) })} actions={<div className="flex flex-wrap gap-2"><Link href={`${B}/recipes/new`} className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground" data-testid="new-recipe">{l.newRecipe}</Link><SimpleAction l={l} what="import" label={l.importFromTill} testid="import-till" /></div>} />
      <div className="space-y-6">
        <Card data-testid="dish-list"><CardHeader><CardTitle>{l.dishes}</CardTitle></CardHeader><CardContent>
          {dishes.length === 0 ? <p className="text-sm text-muted-foreground">{l.noDishes}</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[40rem] text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-2">{l.dish}</th><th className="py-1 pr-2 text-right">{l.costPortion}</th><th className="py-1 pr-2 text-right">{l.price}</th><th className="py-1 pr-2 text-right">{l.foodCost}</th><th className="py-1 pr-2 text-right">{l.margin}</th><th className="py-1 text-right">{l.suggestedPrice}</th></tr></thead>
              <tbody className="divide-y">{dishes.map((d) => (
                <tr key={d.id} data-testid="dish-row">
                  <td className="py-2 pr-2"><Link href={`${B}/recipes/${d.id}`} className="font-medium hover:text-primary">{d.name}</Link>{d.missing > 0 && <span className="ml-1 text-xs text-amber-600" title={l.missingCost}>⚠</span>}{!d.active && <Badge variant="outline" className="ml-1">{l.inactive}</Badge>}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{eur(d.cost, locale)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{eur(d.priceGross, locale)}</td>
                  <td className={`py-2 pr-2 text-right tabular-nums ${d.over ? "font-semibold text-destructive" : ""}`} data-testid="dish-pct">{pct(d.foodCostPct, locale)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{eur(d.margin, locale)}</td>
                  <td className="py-2 text-right tabular-nums">{d.over ? eur(d.suggested, locale) : "—"}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </CardContent></Card>
        <Card data-testid="sub-list"><CardHeader><CardTitle>{l.subRecipes}</CardTitle><CardDescription>{l.subIntro}</CardDescription></CardHeader><CardContent>
          {subs.length === 0 ? <p className="text-sm text-muted-foreground">{l.noSubs}</p> : (
            <ul className="divide-y text-sm">{subs.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><Link href={`${B}/recipes/${r.id}`} className="font-medium hover:text-primary">{r.name}</Link><span className="tabular-nums">{fill(l.perUnit, { cost: eur(r.cost, locale, 3), unit: l[`unit.${r.yieldUnit ?? "KG"}`] })}</span></li>)}</ul>
          )}
        </CardContent></Card>
      </div>
    </>
  );
}

export async function RecipeView({ ctx, id }: { ctx: Ctx; id: string }) {
  const { l, locale } = await kitchenLabels();
  const isNew = id === "new";
  const data = await load(async () => (isNew ? { fresh: await K.newRecipeOptions(ctx) } : { ...(await K.recipeDetail(ctx, id)), fresh: null }));
  if (!data) return <Closed l={l} title={l.recipesTitle} icon={Soup} />;
  const a = await K.kitchenAccess(ctx.company);
  if (isNew) {
    const f = data.fresh!;
    return (
      <>
        <Link href={`${B}/recipes`} className="text-sm text-primary hover:underline">← {l.recipesTitle}</Link>
        <PageHeader title={l.newRecipe} icon={Soup} />
        <Card><CardContent className="pt-6"><RecipeEditor l={l} locale={locale} base={`${B}/recipes`} init={{ id: null, name: "", kind: "DISH", category: null, posItemId: null, yieldQty: 1, yieldUnit: null, priceGross: null, vatRate: 13, ownTarget: null, soldPerWeek: null, notes: null, active: true, lineRows: [] }} ingredients={f.ingredients} subRecipes={f.subRecipes} posItems={f.posItems} /></CardContent></Card>
      </>
    );
  }
  const d = data as Awaited<ReturnType<typeof K.recipeDetail>>;
  const r = d.recipe;
  return (
    <>
      <Link href={`${B}/recipes`} className="text-sm text-primary hover:underline">← {l.recipesTitle}</Link>
      <PageHeader title={r.name} icon={Soup} description={r.kind === "SUB" ? fill(l.subMakes, { n: qtyText(r.yieldQty, locale), unit: l[`unit.${r.yieldUnit ?? "KG"}`] }) : r.posItemName ? fill(l.soldAsTill, { name: r.posItemName }) : undefined} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card><CardContent className="pt-6"><RecipeEditor l={l} locale={locale} base={`${B}/recipes`} init={{ ...r, ownTarget: r.ownTarget, lineRows: r.lineRows }} ingredients={d.ingredients} subRecipes={d.subRecipes} posItems={[...d.posItems, ...(r.posItemId && r.posItemName ? [{ id: r.posItemId, name: r.posItemName, price: r.priceGross ?? 0 }] : [])]} /></CardContent></Card>
        <div className="space-y-4">
          <Card data-testid="recipe-cost"><CardHeader><CardTitle>{l.costing}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
            <dl className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border p-2"><dt className="text-xs text-muted-foreground">{r.kind === "DISH" ? l.costPortion : fill(l.costPerUnitOf, { unit: l[`unit.${r.yieldUnit ?? "KG"}`] })}</dt><dd className="font-semibold tabular-nums" data-testid="recipe-unit-cost">{eur(r.cost, locale, r.kind === "DISH" ? 2 : 3)}</dd></div>
              {r.kind === "DISH" && <div className="rounded-lg border p-2"><dt className="text-xs text-muted-foreground">{l.foodCost}</dt><dd className={`font-semibold tabular-nums ${r.over ? "text-destructive" : ""}`} data-testid="recipe-pct">{pct(r.foodCostPct, locale)}</dd><dd className="text-xs text-muted-foreground">{fill(l.targetIs, { target: pct(r.targetPct, locale) })}</dd></div>}
              {r.kind === "DISH" && <div className="rounded-lg border p-2"><dt className="text-xs text-muted-foreground">{l.margin}</dt><dd className="font-semibold tabular-nums">{eur(r.margin, locale)}</dd></div>}
              <div className="rounded-lg border p-2"><dt className="text-xs text-muted-foreground">{l.co2}</dt><dd className="font-semibold tabular-nums">{qtyText(r.co2, locale, 2)} kg</dd></div>
            </dl>
            {r.missing > 0 && <p className="text-xs text-amber-700 dark:text-warning">{l.missingCost}</p>}
            {r.kind === "DISH" && a.parts.priceSuggestions && r.suggested != null && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3" data-testid="suggested-price">
                <p className="text-xs text-muted-foreground">{fill(l.toHitTarget, { target: pct(r.targetPct, locale) })}</p>
                <p className="text-lg font-semibold tabular-nums">{eur(r.suggested, locale)}</p>
                {r.over && (!r.posItemId || d.canEditTill) && <SimpleAction l={l} what="price" id={r.id} label={r.posItemId ? l.useOnTill : l.usePrice} testid="apply-price" />}
              </div>
            )}
            {r.lines.length > 0 && (
              <table className="w-full text-xs"><tbody className="divide-y">{r.lines.map((x, i) => <tr key={i}><td className="py-1 pr-2">{x.name}{x.approx && <span title={l.approxUnit}> ≈</span>}{x.badUnit && <span className="text-destructive" title={l.badUnit}> ⚠</span>}</td><td className="py-1 pr-2 text-right tabular-nums">{qtyText(x.qty, locale, 3)} {l[`lineUnit.${x.unit}`]}</td><td className="py-1 text-right tabular-nums">{eur(x.cost, locale, 3)}</td></tr>)}</tbody></table>
            )}
          </CardContent></Card>
          {a.parts.allergens && (
            <Card data-testid="recipe-allergens"><CardHeader><CardTitle>{l.allergens}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
              <Allergens codes={r.allergens} l={l} />
              <p className="text-xs text-muted-foreground">{l.allergensNote}</p>
              {r.posItemId && d.canEditTill && <SimpleAction l={l} what="allergens" id={r.id} label={l.pushAllergens} testid="push-allergens" />}
            </CardContent></Card>
          )}
          <DeleteButton l={l} kind="recipe" id={r.id} confirmText={l.deleteConfirm} />
        </div>
      </div>
    </>
  );
}

// ── menu engineering ────────────────────────────────────────────────────────

const CLS_TONE: Record<string, string> = { STAR: "border-emerald-500/40 bg-emerald-500/10", PLOWHORSE: "border-sky-500/40 bg-sky-500/10", PUZZLE: "border-violet-500/40 bg-violet-500/10", DOG: "border-rose-500/40 bg-rose-500/10" };

export async function EngineeringView({ ctx, days }: { ctx: Ctx; days?: number }) {
  const { l, locale } = await kitchenLabels();
  const data = await load(async () => ({ e: await K.menuEngineering(ctx, days), ings: await K.listIngredients(ctx).catch(() => []), a: await K.kitchenAccess(ctx.company) }));
  if (!data) return <Closed l={l} title={l.engineeringTitle} icon={LineChart} />;
  const { e } = data;
  return (
    <>
      <PageHeader title={l.engineeringTitle} icon={LineChart} description={fill(l.engineeringIntro, { days: e.days })} />
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2 text-sm">{[7, 30, 90].map((d) => <Link key={d} href={`${B}/engineering?days=${d}`} className={`rounded-full border px-3 py-1 ${e.days === d ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`}>{fill(l.lastDays, { n: d })}</Link>)}</div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="engineering-grid">
          {(["STAR", "PLOWHORSE", "PUZZLE", "DOG"] as const).map((c) => {
            const items = e.items.filter((i) => i.cls === c);
            return (
              <div key={c} className={`rounded-2xl border p-4 ${CLS_TONE[c]}`} data-testid={`eng-${c}`}>
                <p className="font-semibold">{l[`cls.${c}`]}</p>
                <p className="mb-2 text-xs text-muted-foreground">{l[`clsHint.${c}`]}</p>
                {items.length === 0 ? <p className="text-xs text-muted-foreground">—</p> : <ul className="space-y-1 text-sm">{items.map((i) => <li key={i.id} className="flex justify-between gap-2"><Link href={`${B}/recipes/${i.id}`} className="min-w-0 break-words hover:underline">{i.name}</Link><span className="shrink-0 tabular-nums text-xs">{qtyText(i.sold, locale, 0)} · {eur(i.margin, locale)}</span></li>)}</ul>}
              </div>
            );
          })}
        </div>
        {e.avgMargin != null && <p className="text-xs text-muted-foreground">{fill(l.engineeringNote, { margin: eur(e.avgMargin, locale), mix: pct(e.popularAt, locale) })}</p>}
        {e.unpriced.length > 0 && <p className="text-xs text-amber-700 dark:text-warning">{fill(l.unpriced, { names: e.unpriced.map((u) => u.name).join(", ") })}</p>}
        {data.a.parts.priceSuggestions && data.ings.length > 0 && (
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><Flame className="size-5" aria-hidden /> {l.whatIfTitle}</CardTitle><CardDescription>{l.whatIfIntro}</CardDescription></CardHeader>
            <CardContent><WhatIf l={l} locale={locale} ingredients={data.ings.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name }))} /></CardContent></Card>
        )}
      </div>
    </>
  );
}

// ── waste ───────────────────────────────────────────────────────────────────

function WasteTable({ l, locale, rows, donation = false }: { l: L; locale: string; rows: Awaited<ReturnType<typeof K.wasteList>>; donation?: boolean }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{donation ? l.noDonations : l.noWaste}</p>;
  return (
    <ul className="divide-y" data-testid={donation ? "donation-list" : "waste-list"}>
      {rows.map((w) => (
        <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm" data-testid="waste-row">
          <span className="min-w-0 flex-1 break-words"><b>{w.label}</b> · {qtyText(w.qty, locale, 3)} {l[`lineUnit.${w.unit}`]}{w.fromLot && <Badge variant="secondary" className="ml-1">{l.fromLot}</Badge>}
            <span className="block text-xs text-muted-foreground">{dateText(w.at, locale)} · {donation ? `${w.recipient}${w.receiptRef ? ` · ${w.receiptRef}` : ""}` : l[`reason.${w.reason}`]} · {w.by}{w.note ? ` · ${w.note}` : ""}</span>
          </span>
          <span className="tabular-nums">{eur(w.cost, locale)}</span>
          {w.co2 != null && <span className="text-xs tabular-nums text-muted-foreground">{qtyText(w.co2, locale)} kg CO₂e</span>}
          {w.canDelete && <DeleteButton l={l} kind="waste" id={w.id} confirmText={l.deleteConfirm} />}
        </li>
      ))}
    </ul>
  );
}

export async function WasteView({ ctx }: { ctx: Ctx }) {
  const { l, locale } = await kitchenLabels();
  const data = await load(async () => ({ opts: await K.wasteOptions(ctx, locale), rows: await K.wasteList(ctx, { days: 14 }) }));
  if (!data) return <Closed l={l} title={l.wasteTitle} icon={Trash2} />;
  const today = data.rows.filter((r) => new Date(r.at).toDateString() === new Date().toDateString());
  return (
    <>
      <PageHeader title={l.wasteTitle} icon={Trash2} description={l.wasteIntro} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,28rem)_1fr]">
        <Card><CardContent className="pt-6"><WasteLogger l={l} locale={locale} ingredients={data.opts.ingredients} recipes={data.opts.recipes} lots={data.opts.lots.map((x) => ({ ...x, expiresOn: x.expiresOn.toISOString() }))} /></CardContent></Card>
        <Card><CardHeader><CardTitle>{l.recentWaste}</CardTitle><CardDescription>{fill(l.todaySum, { cost: eur(today.reduce((s, r) => s + r.cost, 0), locale), n: today.length })}</CardDescription></CardHeader><CardContent><WasteTable l={l} locale={locale} rows={data.rows} /></CardContent></Card>
      </div>
    </>
  );
}

export async function DonationsView({ ctx }: { ctx: Ctx }) {
  const { l, locale } = await kitchenLabels();
  const data = await load(async () => ({ opts: await K.wasteOptions(ctx, locale), rows: await K.wasteList(ctx, { kind: "DONATION", days: 365 }) }));
  if (!data || !data.opts.donations) return <Closed l={l} title={l.donationsTitle} icon={Gift} />;
  const kg = data.rows.reduce((s, r) => s + (r.kg ?? 0), 0);
  return (
    <>
      <PageHeader title={l.donationsTitle} icon={Gift} description={l.donationsIntro} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,28rem)_1fr]">
        <Card><CardContent className="pt-6"><WasteLogger l={l} locale={locale} kind="DONATION" ingredients={data.opts.ingredients} recipes={data.opts.recipes} lots={[]} /></CardContent></Card>
        <Card><CardHeader><CardTitle>{l.donationsYear}</CardTitle><CardDescription>{fill(l.donatedSum, { kg: qtyText(kg, locale, 1), n: data.rows.length })}</CardDescription></CardHeader><CardContent><WasteTable l={l} locale={locale} rows={data.rows} donation /></CardContent></Card>
      </div>
    </>
  );
}

export async function WasteReportsView({ ctx, days }: { ctx: Ctx; days: number }) {
  const { l, locale } = await kitchenLabels();
  const r = await load(() => K.wasteReport(ctx, days));
  if (!r) return <Closed l={l} title={l.reportsTitle} icon={Recycle} />;
  const max = Math.max(1, ...r.weekly.map((w) => w.cost));
  return (
    <>
      <PageHeader title={l.reportsTitle} icon={Recycle} description={l.reportsIntro} />
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2 text-sm">{[7, 30, 90].map((d) => <Link key={d} href={`${B}/waste/reports?days=${d}`} className={`rounded-full border px-3 py-1 ${r.days === d ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`}>{fill(l.lastDays, { n: d })}</Link>)}</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="report-tiles">
          {tile(l.wasteCost, eur(r.cost, locale), { testid: "report-cost" })}
          {tile(l.wasteKg, `${qtyText(r.kg, locale, 1)} kg`)}
          {tile(l.wasteCo2, `${qtyText(r.co2, locale, 1)} kg`)}
          {tile(fill(l.wasteVsTarget, { target: pct(r.targetPct, locale) }), pct(r.pctOfPurchases, locale), { testid: "report-pct", tone: r.overTarget ? "warn" : "ok" })}
          {tile(l.donated, `${qtyText(r.donations.kg, locale, 1)} kg`)}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card><CardHeader><CardTitle>{l.byReason}</CardTitle></CardHeader><CardContent>
            {r.byReason.length === 0 ? <p className="text-sm text-muted-foreground">{l.noWaste}</p> : <ul className="space-y-2" data-testid="by-reason">{r.byReason.map((x) => (
              <li key={x.reason} className="text-sm"><div className="flex justify-between gap-2"><span>{l[`reason.${x.reason}`]}</span><span className="tabular-nums">{eur(x.cost, locale)}</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-rose-500/70" style={{ width: `${r.cost ? (x.cost / r.cost) * 100 : 0}%` }} /></div></li>
            ))}</ul>}
          </CardContent></Card>
          <Card><CardHeader><CardTitle>{l.weekly}</CardTitle></CardHeader><CardContent>
            <div className="flex h-36 items-end gap-1.5" role="img" aria-label={l.weekly}>{r.weekly.map((w) => (
              <div key={w.week} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${w.week}: ${eur(w.cost, locale)}`}>
                <div className="w-full rounded-t bg-rose-500/70" style={{ height: `${(w.cost / max) * 100}%`, minHeight: w.cost ? 3 : 0 }} />
                <span className="text-[10px] text-muted-foreground">{dateText(w.week, locale)}</span>
              </div>
            ))}</div>
          </CardContent></Card>
        </div>
        <Card><CardHeader><CardTitle>{l.byItem}</CardTitle></CardHeader><CardContent>
          {r.byItem.length === 0 ? <p className="text-sm text-muted-foreground">{l.noWaste}</p> : <ul className="divide-y text-sm" data-testid="by-item">{r.byItem.slice(0, 15).map((x) => <li key={x.key} className="flex justify-between gap-2 py-1.5"><span className="min-w-0 break-words">{x.label} <span className="text-xs text-muted-foreground">· {fill(l.timesN, { n: x.count })}</span></span><span className="tabular-nums">{eur(x.cost, locale)}</span></li>)}</ul>}
        </CardContent></Card>
      </div>
    </>
  );
}

export async function UseFirstView({ ctx }: { ctx: Ctx }) {
  const { l, locale } = await kitchenLabels();
  const s = await load(() => K.kitchenSuggestions(ctx, locale));
  if (!s) return <Closed l={l} title={l.useFirstTitle} icon={Recycle} />;
  return (
    <>
      <PageHeader title={l.useFirstTitle} icon={Recycle} description={fill(l.useFirstIntro, { days: s.useFirstDays })} />
      <div className="space-y-6">
        <Card data-testid="use-first"><CardHeader><CardTitle>{l.useFirstList}</CardTitle></CardHeader><CardContent>
          {s.useFirst.length === 0 ? <p className="text-sm text-muted-foreground">{l.nothingUseFirst}</p> : <ul className="divide-y">{s.useFirst.map((x) => (
            <li key={x.id} className="space-y-1 py-2 text-sm" data-testid="use-first-row">
              <div className="flex flex-wrap items-center gap-2"><b className="min-w-0 break-words">{x.product}</b><span className="text-xs text-muted-foreground">{x.pack}{x.lotCode ? ` · ${x.lotCode}` : ""}</span>
                <Badge variant={x.daysLeft <= 0 ? "destructive" : "warning"}>{x.daysLeft < 0 ? l.expired : x.daysLeft === 0 ? l.today : fill(l.inDays, { n: x.daysLeft })}</Badge>
                <span className="ml-auto tabular-nums">{fill(l.packsLeft, { n: x.left })}{x.value != null ? ` · ${eur(x.value, locale)}` : ""}</span></div>
              {x.dishes.length > 0 && <p className="text-xs text-muted-foreground">{l.useIn}: {x.dishes.map((d, i) => <span key={d.id}>{i ? ", " : ""}<Link href={`${B}/recipes/${d.id}`} className="text-primary hover:underline">{d.name}</Link></span>)}</p>}
            </li>
          ))}</ul>}
          <Link href={`${B}/waste`} className="mt-3 inline-block text-sm text-primary hover:underline">{l.logWaste} →</Link>
        </CardContent></Card>
        <Card data-testid="order-less"><CardHeader><CardTitle>{l.orderLessTitle}</CardTitle><CardDescription>{l.orderLessIntro}</CardDescription></CardHeader><CardContent>
          {s.orderLess.length === 0 ? <p className="text-sm text-muted-foreground">{l.nothingOrderLess}</p> : <ul className="divide-y text-sm">{s.orderLess.map((x) => (
            <li key={x.ingredientId} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="min-w-0 break-words"><b>{x.name}</b> <span className="text-xs text-muted-foreground">· {fill(l.wastedTimes, { n: x.wasteEntries, qty: qtyText(x.wastedQty, locale), unit: l[`unit.${x.unit}`] })}</span></span><Badge variant="warning">{fill(l.cutBy, { pct: x.cutPct })}</Badge></li>
          ))}</ul>}
        </CardContent></Card>
      </div>
    </>
  );
}
