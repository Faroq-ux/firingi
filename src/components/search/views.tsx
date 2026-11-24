/** Phase 72: the buyer's search page — filters (one GET form) and what the AI understood, as removable chips. */
import Link from "next/link";
import { Sparkles, SlidersHorizontal, X } from "lucide-react";
import { ALLERGENS, DIETS } from "@/lib/food";
import { SORTS, filterParams, type SearchFilters } from "@/lib/search";

const BASE = "/buy/catalogue/search";
export type SearchLabels = Record<string, string>;
type Facet = { id: string; name: string; count: number };
const href = (p: Record<string, string>) => `${BASE}?${new URLSearchParams(p).toString()}`;

export function SearchFilterPanel({ q, f, facets, showSupplier, food, l, fl, aiOff }: {
  q: string; f: SearchFilters; facets: { categories: Facet[]; suppliers: Facet[] }; showSupplier: boolean; food: boolean;
  l: SearchLabels; fl: Record<string, string>; aiOff: boolean;
}) {
  const active = !!(f.cat || f.vendor || f.max || f.deal || f.free.length || f.diet || f.stars || f.sort !== "relevance");
  return (
    <details className="glass-panel rounded-2xl border p-3 text-sm lg:open:p-4" open data-testid="search-filters">
      <summary className="flex cursor-pointer items-center gap-2 font-medium"><SlidersHorizontal className="size-4" aria-hidden /> {l.filters}</summary>
      <form action={BASE} method="get" className="mt-3 space-y-3">
        <input type="hidden" name="q" value={q} />
        {aiOff && <input type="hidden" name="aif" value="0" />}
        <label className="block space-y-1"><span className="text-xs text-muted-foreground">{l.sort}</span>
          <select name="sort" defaultValue={f.sort} className="h-9 w-full rounded-md border bg-background px-2" data-testid="sf-sort">
            {SORTS.map((s) => <option key={s} value={s}>{l[`sortBy.${s}`]}</option>)}
          </select>
        </label>
        <label className="block space-y-1"><span className="text-xs text-muted-foreground">{l.category}</span>
          <select name="cat" defaultValue={f.cat ?? ""} className="h-9 w-full rounded-md border bg-background px-2" data-testid="sf-cat">
            <option value="">{l.anyCategory}</option>
            {facets.categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.count})</option>)}
          </select>
        </label>
        {showSupplier && (
          <label className="block space-y-1"><span className="text-xs text-muted-foreground">{l.supplier}</span>
            <select name="vendor" defaultValue={f.vendor ?? ""} className="h-9 w-full rounded-md border bg-background px-2" data-testid="sf-vendor">
              <option value="">{l.anySupplier}</option>
              {facets.suppliers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.count})</option>)}
            </select>
          </label>
        )}
        <label className="block space-y-1"><span className="text-xs text-muted-foreground">{l.maxPrice}</span>
          <input name="max" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={f.max ?? ""} className="h-9 w-full rounded-md border bg-background px-2" data-testid="sf-max" />
        </label>
        <label className="flex items-center gap-2"><input type="checkbox" name="deal" value="1" defaultChecked={f.deal} data-testid="sf-deal" /> {l.dealsOnly}</label>
        <label className="block space-y-1"><span className="text-xs text-muted-foreground">{l.rating}</span>
          <select name="stars" defaultValue={f.stars ?? ""} className="h-9 w-full rounded-md border bg-background px-2" data-testid="sf-stars">
            <option value="">{l.anyRating}</option>
            {[4, 3].map((n) => <option key={n} value={n}>{l.starsUp.replace("{n}", String(n))}</option>)}
          </select>
        </label>
        {food && (
          <fieldset className="space-y-1">
            <legend className="text-xs text-muted-foreground">{fl.freeFrom}</legend>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {ALLERGENS.map((a) => <label key={a} className="flex items-center gap-1.5"><input type="checkbox" name="free" value={a} defaultChecked={f.free.includes(a)} data-testid={`sf-free-${a}`} />{fl[`a.${a}`] ?? a}</label>)}
            </div>
            <select name="diet" defaultValue={f.diet ?? ""} className="mt-2 h-9 w-full rounded-md border bg-background px-2" aria-label={fl.dietsTitle} data-testid="sf-diet">
              <option value="">{fl.anyDiet}</option>
              {DIETS.map((d) => <option key={d} value={d}>{fl[`diet.${d}`] ?? d}</option>)}
            </select>
          </fieldset>
        )}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button type="submit" className="h-9 rounded-md bg-primary px-4 text-primary-foreground" data-testid="sf-apply">{l.apply}</button>
          {active && <Link href={href({ q, ...(aiOff ? { aif: "0" } : {}) })} className="text-primary hover:underline" data-testid="sf-clear">{l.clear}</Link>}
        </div>
      </form>
    </details>
  );
}

/** What the AI understood: the product words, a spelling fix, and the filters it applied — each removable. */
export function UnderstoodBar({ q, f, meta, l, fl, money, aiOff, aiReady }: {
  q: string; f: SearchFilters; l: SearchLabels; fl: Record<string, string>; money: (n: number) => string; aiOff: boolean; aiReady: boolean;
  meta: { partial: boolean; aiApplied: string[]; understood: { corrected: string | null; simulated: boolean; words: string[] } | null } | null;
}) {
  if (!meta) return null;
  const u = meta.understood;
  // Removing one AI filter: keep the others as the buyer's own, switch the AI's filters off.
  const without = (key: string) => {
    const keep: Partial<SearchFilters> = { ...f };
    if (key === "free") keep.free = []; if (key === "diet") keep.diet = null; if (key === "max") keep.max = null; if (key === "deal") keep.deal = false; if (key === "sort") keep.sort = "relevance";
    return href({ ...filterParams({ ...keep, q }), aif: "0" });
  };
  const chip = (key: string) => {
    const text = key === "max" ? l.chipMax.replace("{price}", money(f.max ?? 0)) : key === "deal" ? l.chipDeal : key === "sort" ? l[`sortBy.${f.sort}`]
      : key === "diet" ? (fl[`diet.${f.diet}`] ?? f.diet ?? "") : l.chipFree.replace("{list}", f.free.map((a) => fl[`a.${a}`] ?? a).join(", "));
    return (
      <Link key={key} href={without(key)} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary hover:bg-primary/20" title={l.remove} data-testid={`chip-${key}`}>
        {text} <X className="size-3" aria-label={l.remove} />
      </Link>
    );
  };
  const show = u || meta.partial || aiOff;
  if (!show) return null;
  return (
    <div className="mb-4 space-y-2 text-sm" data-testid="understood">
      {u && (u.words.length > 0 || meta.aiApplied.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 font-medium"><Sparkles className="size-4 text-primary" aria-hidden /> {l.understood}{u.simulated ? ` (${l.simulated})` : ""}:</span>
          {u.words.length > 0 && <span data-testid="understood-words">{l.lookingFor.replace("{words}", u.words.join(", "))}</span>}
          {meta.aiApplied.map(chip)}
          {meta.aiApplied.length > 0 && <Link href={href({ ...filterParams({ ...f, q, free: meta.aiApplied.includes("free") ? [] : f.free, diet: meta.aiApplied.includes("diet") ? null : f.diet, max: meta.aiApplied.includes("max") ? null : f.max, deal: meta.aiApplied.includes("deal") ? false : f.deal, sort: meta.aiApplied.includes("sort") ? "relevance" : f.sort }), aif: "0" })} className="text-xs text-muted-foreground underline hover:text-foreground" data-testid="only-words">{l.onlyWords}</Link>}
        </div>
      )}
      {u?.corrected && u.corrected !== q.trim().toLowerCase() && <p data-testid="did-you-mean"><Link href={href({ q: u.corrected })} className="text-primary hover:underline">{l.didYouMean.replace("{q}", u.corrected)}</Link></p>}
      {aiOff && aiReady && <p><Link href={href(filterParams({ ...f, q }))} className="text-xs text-primary hover:underline" data-testid="use-ai">{l.useAi}</Link></p>}
      {meta.partial && <p className="text-muted-foreground" data-testid="partial">{l.partial}</p>}
    </div>
  );
}
