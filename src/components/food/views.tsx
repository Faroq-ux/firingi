/** Food information (Phase 44) — server-rendered pieces: card badges, the product panel (also the public page), the catalogue filter, recipe changes. */
import { AlertTriangle, Leaf, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ALLERGENS, DIETS, NUTRIENTS, type FoodDiff, type Nutrition } from "@/lib/food";
import { fill } from "./labels";

type L = Record<string, string>;

/** ?free=GLUTEN&free=MILK (or free=GLUTEN,MILK) and ?diet=VEGAN from the catalogue URL. */
export function foodParams(sp: { free?: string | string[]; diet?: string }) {
  const free = [sp.free ?? []].flat().flatMap((x) => x.split(",")).filter((x) => (ALLERGENS as readonly string[]).includes(x));
  const diet = sp.diet && (DIETS as readonly string[]).includes(sp.diet) ? sp.diet : null;
  return { free: [...new Set(free)], diet };
}
const names = (l: L, codes: string[]) => codes.map((c) => l[`a.${c}`] ?? c).join(", ");

/** Product cards / lists: what it contains, its diets, and a warning when it hits the kitchen's avoid list. */
export function FoodCardBadges({ food, hits, l }: { food: { approved: boolean; contain: string[]; mayContain: string[]; diets: string[] }; hits?: string[]; l: L }) {
  if (!food.approved && !hits?.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1 text-[11px]" data-testid="food-badges" data-contain={food.contain.join(",")}>
      {hits && hits.length > 0 && <Badge variant="destructive" className="gap-1" data-testid="food-hit"><ShieldAlert className="size-3" />{fill(l.onAvoidList, { allergens: names(l, hits).toLowerCase() })}</Badge>}
      {food.contain.length > 0 && <span className="text-muted-foreground">{l.contains}: <b className="font-medium text-foreground">{names(l, food.contain).toLowerCase()}</b></span>}
      {food.diets.slice(0, 2).map((d) => <Badge key={d} variant="success" className="gap-1"><Leaf className="size-3" />{l[`diet.${d}`]}</Badge>)}
    </span>
  );
}

export type PanelData = {
  approved: true; name: string; brand: string | null; version: number; approvedAt: Date | null;
  allergens: { code: string; level: string | null; detail: string | null }[]; contain: string[]; mayContain: string[];
  ingredients: { lang: string; segments: { t: string; b?: boolean }[] } | null; nutrition: Nutrition | null; diets: string[];
  certificates: { diet: string; number: string | null; issuer: string | null; expiresOn: Date | null }[];
  origin: string | null; storage: string | null; shelfLifeDays: number | null; afterOpeningDays: number | null; hits: string[]; changedAt: Date | null;
};
const fmt = (v: number | undefined, locale: string) => (v == null ? "—" : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v));
const LEVEL_TONE: Record<string, string> = {
  CONTAINS: "border-red-500/50 bg-red-500/10 text-red-700 dark:border-red-400/60 dark:bg-red-500/20 dark:text-red-200",
  MAY_CONTAIN: "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:border-amber-400/60 dark:bg-amber-500/20 dark:text-amber-200",
  FREE: "bg-muted text-muted-foreground",
};

/** The full food information (product page and the public shopper page). */
export function FoodPanel({ f, l, locale, labelHref }: { f: PanelData; l: L; locale: string; labelHref?: string | null }) {
  const date = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(d));
  const country = (c: string) => { try { return new Intl.DisplayNames([locale], { type: "region" }).of(c) ?? c; } catch { return c; } };
  const lang = (c: string) => { try { return new Intl.DisplayNames([locale], { type: "language" }).of(c) ?? c; } catch { return c; } };
  return (
    <div className="space-y-4 text-sm" data-testid="food-panel">
      {f.hits.length > 0 && <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-destructive" data-testid="food-hit"><ShieldAlert className="mt-0.5 size-4 shrink-0" />{fill(l.onAvoidList, { allergens: names(l, f.hits).toLowerCase() })}</p>}
      {f.changedAt && <p className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300" data-testid="food-changed"><AlertTriangle className="size-3.5" />{fill(l.changedOn, { date: date(f.changedAt) })}</p>}
      {f.allergens.length > 0 && (
        <div>
          <p className="mb-1.5 font-medium">{l.allergens}</p>
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3" data-testid="food-allergens">
            {f.allergens.map((a) => (
              <li key={a.code} className={`flex min-w-0 items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs ${a.level ? LEVEL_TONE[a.level] : ""}`} data-allergen={a.code} data-level={a.level ?? ""}>
                <span className="min-w-0 break-words">{l[`a.${a.code}`]}{a.detail ? <span className="opacity-75"> ({a.detail})</span> : null}</span>
                <span className="shrink-0 font-medium">{a.level ? l[`level.${a.level}`] : "?"}</span>
              </li>
            ))}
          </ul>
          {!f.contain.length && !f.mayContain.length && <p className="mt-1 text-xs text-muted-foreground">{l.noneOf14}</p>}
        </div>
      )}
      {f.ingredients && (
        <div>
          <p className="mb-1 font-medium">{l.ingredients}</p>
          <p className="break-words" data-testid="food-ingredients">{f.ingredients.segments.map((s, i) => (s.b ? <b key={i} className="font-semibold">{s.t}</b> : <span key={i}>{s.t}</span>))}</p>
          {!locale.startsWith(f.ingredients.lang.split("-")[0]) && <p className="mt-0.5 text-xs text-muted-foreground">{fill(l.shownIn, { lang: lang(f.ingredients.lang) })}</p>}
        </div>
      )}
      {f.nutrition && (
        <div>
          <p className="mb-1 font-medium">{fill(l.nutritionPer, { basis: f.nutrition.basis === "100ml" ? "100 ml" : "100 g" })}</p>
          <table className="w-full max-w-sm text-xs" data-testid="food-nutrition"><tbody>
            {NUTRIENTS.filter((n) => f.nutrition![n] != null).map((n) => (
              <tr key={n} className="border-b last:border-0"><td className={`py-1 ${n === "saturates" || n === "sugars" ? "pl-4 text-muted-foreground" : ""}`}>{l[`n.${n}`]}</td><td className="py-1 text-right tabular-nums">{fmt(f.nutrition![n], locale)}{n.startsWith("energy") ? "" : " g"}</td></tr>
            ))}
          </tbody></table>
        </div>
      )}
      {f.diets.length > 0 && (
        <div>
          <p className="mb-1 font-medium">{l.dietsTitle}</p>
          <div className="flex flex-wrap gap-1.5" data-testid="food-diets">{f.diets.map((d) => {
            const c = f.certificates.find((x) => x.diet === d);
            return <Badge key={d} variant="success" className="gap-1" title={c?.number ? fill(l.certified, { number: c.number }) : undefined}><Leaf className="size-3" />{l[`diet.${d}`]}{c?.number ? " ✓" : ""}</Badge>;
          })}</div>
        </div>
      )}
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        {f.origin && <div><dt className="inline text-muted-foreground">{l.originLabel}: </dt><dd className="inline">{country(f.origin)}</dd></div>}
        {f.storage && <div className="sm:col-span-2"><dt className="inline text-muted-foreground">{l.storageLabel}: </dt><dd className="inline break-words">{f.storage}</dd></div>}
        {f.shelfLifeDays && <div>{fill(l.shelfDays, { days: f.shelfLifeDays })}</div>}
        {f.afterOpeningDays && <div>{fill(l.openedDays, { days: f.afterOpeningDays })}</div>}
      </dl>
      <p className="text-xs text-muted-foreground">{f.approvedAt ? fill(l.checkedOn, { date: date(f.approvedAt) }) : null}{labelHref ? <> · <a href={labelHref} className="text-primary hover:underline" target="_blank" rel="noreferrer">{l.labelLink}</a></> : null}</p>
    </div>
  );
}

/** Catalogue filter: free from (allergens) and a diet — a plain GET form. */
export function FoodFilter({ base, params, free, diet, l }: { base: string; params: Record<string, string | undefined>; free: string[]; diet: string | null; l: L }) {
  const on = free.length > 0 || !!diet;
  return (
    <details className="glass-panel mb-4 rounded-2xl border p-3 text-sm" open={on} data-testid="food-filter">
      <summary className="cursor-pointer font-medium">{l.filterTitle}{on ? ` · ${[...free.map((a) => l[`a.${a}`]), diet ? l[`diet.${diet}`] : null].filter(Boolean).join(", ")}` : ""}</summary>
      <form action={base} method="get" className="mt-3 space-y-3">
        {Object.entries(params).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <fieldset>
          <legend className="mb-1 text-xs text-muted-foreground">{l.freeFrom}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {ALLERGENS.map((a) => <label key={a} className="flex items-center gap-1.5"><input type="checkbox" name="free" value={a} defaultChecked={free.includes(a)} data-testid={`free-${a}`} />{l[`a.${a}`]}</label>)}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <select name="diet" defaultValue={diet ?? ""} className="h-9 rounded-md border bg-background px-2" aria-label={l.dietsTitle} data-testid="food-diet">
            <option value="">{l.anyDiet}</option>
            {DIETS.map((d) => <option key={d} value={d}>{l[`diet.${d}`]}</option>)}
          </select>
          <button type="submit" className="h-9 rounded-md bg-primary px-3 text-primary-foreground" data-testid="food-filter-apply">{l.applyFilter}</button>
          {on && <a href={`${base}?${new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString()}`} className="text-primary hover:underline">{l.clearFilter}</a>}
        </div>
        <p className="text-xs text-muted-foreground">{l.filterNote}</p>
      </form>
    </details>
  );
}

/** Recipe changes of the products a customer buys. */
export function RecipeChanges({ rows, l, locale }: { rows: { id: string; productId: string; name: string; at: Date; diff: FoodDiff; urgent: boolean }[]; l: L; locale: string }) {
  if (!rows.length) return <p className="py-3 text-center text-sm text-muted-foreground">{l.noChanges}</p>;
  const date = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(d));
  const n = (c: string[]) => names(l, c).toLowerCase();
  return (
    <ul className="divide-y text-sm" data-testid="food-changes">
      {rows.map((r) => (
        <li key={r.id} className="space-y-0.5 py-2" data-testid="food-change" data-urgent={r.urgent ? "1" : "0"}>
          <p className="flex flex-wrap items-center gap-2"><b className="font-medium">{r.name}</b><span className="text-xs text-muted-foreground">{date(r.at)}</span>{r.urgent && <Badge variant="destructive">{l.urgent}</Badge>}</p>
          <p className="text-xs">
            {[
              r.diff.allergensAdded.length ? fill(l.added, { list: n(r.diff.allergensAdded) }) : null,
              r.diff.mayContainAdded.length ? fill(l.mayAdded, { list: n(r.diff.mayContainAdded) }) : null,
              r.diff.allergensRemoved.length ? fill(l.removedA, { list: n(r.diff.allergensRemoved) }) : null,
              r.diff.ingredients ? l.ingChanged : null,
              r.diff.dietsAdded.length || r.diff.dietsRemoved.length ? l.dietsChanged : null,
            ].filter(Boolean).join(" · ")}
          </p>
        </li>
      ))}
    </ul>
  );
}
