"use client";
/** Menu costing & food waste (Phase 54) — the interactive parts. Texts come in as `l`. */
import { useMemo, useState } from "react";
import { Calculator, Check, Download, Plus, RefreshCw, Save, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  addIngredientFromPurchaseAction, applySuggestedPriceAction, deleteIngredientAction, deleteRecipeAction, deleteWasteAction, importFromTillAction, logWasteAction,
  pushAllergensAction, refreshCostsAction, saveIngredientAction, saveKitchenProfileAction, saveRecipeAction, whatIfAction,
} from "@/server/actions/kitchen";
import { BASE_UNITS, COST_BASES, LINE_UNITS, ROUNDINGS, WASTE_REASONS } from "@/lib/kitchen";
import { ALLERGENS } from "@/lib/food";

type L = Record<string, string>;
type Opt = { id: string; name: string; unit?: string | null };
const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
const eur = (n: number | null | undefined, locale: string) => (n == null ? "—" : new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n));

// ── ingredients ─────────────────────────────────────────────────────────────

export function AddFromPurchase({ l, p }: { l: L; p: { productId: string; name: string; guess: { size: number; unit: string } } }) {
  const { pending, error, run } = useRun();
  const [name, setName] = useState(p.name), [unit, setUnit] = useState(p.guess.unit), [size, setSize] = useState(String(p.guess.size));
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="add-purchase">
      <div className="min-w-40 flex-1"><Label className="text-xs">{l.name}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="w-24"><Label className="text-xs">{l.packHolds}</Label><Input inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} data-testid="add-pack" /></div>
      <div className="w-24"><Label className="text-xs">{l.unitLabel}</Label><Select value={unit} onChange={(e) => setUnit(e.target.value)}>{BASE_UNITS.map((u) => <option key={u} value={u}>{l[`unit.${u}`]}</option>)}</Select></div>
      <Button size="sm" disabled={pending} onClick={() => run(() => addIngredientFromPurchaseAction({ productId: p.productId, name, unit: unit as (typeof BASE_UNITS)[number], packSize: numOrNull(size) }))} data-testid="add-purchase-btn"><Spin on={pending} icon={Plus} /> {l.add}</Button>
      <Msg error={error} />
    </div>
  );
}

type Ing = { id: string; name: string; source: string; unit: string; packSize: number | null; manualCost: number | null; supplierName: string | null; yieldPct: number; allergens: string[]; allergensOwn: boolean; co2PerUnit: number | null; active: boolean };

export function IngredientForm({ l, ing, onDone }: { l: L; ing?: Ing | null; onDone?: () => void }) {
  const { pending, error, done, run } = useRun();
  const firingi = ing?.source === "FIRINGI";
  const [s, setS] = useState({
    name: ing?.name ?? "", unit: ing?.unit ?? "KG", manualCost: ing?.manualCost != null ? String(ing.manualCost) : "", supplierName: ing?.supplierName ?? "", yieldPct: String(ing?.yieldPct ?? 100),
    allergens: (ing?.allergensOwn || !firingi ? ing?.allergens ?? [] : []).filter((a) => !a.startsWith("~")), allergensOwn: ing?.allergensOwn ?? false, co2: ing?.co2PerUnit != null && (ing.allergensOwn || !firingi) ? String(ing.co2PerUnit) : "",
    packSize: ing?.packSize != null ? String(ing.packSize) : "", active: ing?.active ?? true,
  });
  const set = (k: keyof typeof s, v: unknown) => setS({ ...s, [k]: v });
  const toggle = (a: string) => set("allergens", s.allergens.includes(a) ? s.allergens.filter((x) => x !== a) : [...s.allergens, a]);
  const submit = () => run(() => saveIngredientAction({
    id: ing?.id ?? null, name: s.name, unit: s.unit as (typeof BASE_UNITS)[number], manualCost: firingi ? null : numOrNull(s.manualCost), supplierName: s.supplierName || null, yieldPct: Number(s.yieldPct.replace(",", ".")),
    allergens: s.allergens, allergensOwn: firingi ? s.allergensOwn : true, co2PerUnit: numOrNull(s.co2), packSize: firingi ? numOrNull(s.packSize) : null, active: s.active,
  }), () => { if (!ing) setS({ ...s, name: "", manualCost: "", supplierName: "", allergens: [], co2: "" }); onDone?.(); }, l.saved);
  return (
    <div className="space-y-3" data-testid="ingredient-form">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2"><Label className="text-xs">{l.name}</Label><Input value={s.name} onChange={(e) => set("name", e.target.value)} data-testid="ing-name" /></div>
        <div><Label className="text-xs">{l.unitLabel}</Label><Select value={s.unit} onChange={(e) => set("unit", e.target.value)} data-testid="ing-unit">{BASE_UNITS.map((u) => <option key={u} value={u}>{l[`unit.${u}`]}</option>)}</Select></div>
        <div><Label className="text-xs">{l.yieldPct}</Label><Input inputMode="decimal" value={s.yieldPct} onChange={(e) => set("yieldPct", e.target.value)} data-testid="ing-yield" /></div>
        {firingi ? (
          <div><Label className="text-xs">{fill(l.packHoldsUnit, { unit: l[`unit.${s.unit}`] })}</Label><Input inputMode="decimal" value={s.packSize} onChange={(e) => set("packSize", e.target.value)} data-testid="ing-pack" /></div>
        ) : (
          <>
            <div><Label className="text-xs">{fill(l.costPer, { unit: l[`unit.${s.unit}`] })}</Label><Input inputMode="decimal" value={s.manualCost} onChange={(e) => set("manualCost", e.target.value)} data-testid="ing-cost" /></div>
            <div><Label className="text-xs">{l.supplierName}</Label><Input value={s.supplierName} onChange={(e) => set("supplierName", e.target.value)} /></div>
            <div><Label className="text-xs">{fill(l.co2Per, { unit: l[`unit.${s.unit}`] })}</Label><Input inputMode="decimal" value={s.co2} onChange={(e) => set("co2", e.target.value)} /></div>
          </>
        )}
      </div>
      {firingi && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.allergensOwn} onChange={(e) => set("allergensOwn", e.target.checked)} /> {l.allergensOwn}</label>}
      {(!firingi || s.allergensOwn) && (
        <fieldset><legend className="mb-1 text-xs font-medium">{l.allergens}</legend>
          <div className="flex flex-wrap gap-1.5">{ALLERGENS.map((a) => <button key={a} type="button" onClick={() => toggle(a)} className={`rounded-full border px-2 py-0.5 text-xs ${s.allergens.includes(a) ? "border-amber-500 bg-amber-500/15 font-medium" : "hover:bg-muted"}`} aria-pressed={s.allergens.includes(a)} data-testid={`ing-allergen-${a}`}>{l[`allergen.${a}`] ?? a}</button>)}</div>
        </fieldset>
      )}
      {ing && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.active} onChange={(e) => set("active", e.target.checked)} /> {l.active}</label>}
      <div className="flex flex-wrap items-center gap-2"><Button size="sm" disabled={pending} onClick={submit} data-testid="ing-save"><Spin on={pending} icon={Save} /> {ing ? l.save : l.addManual}</Button><Msg error={error} done={done} /></div>
    </div>
  );
}

export function DeleteButton({ l, kind, id, confirmText }: { l: L; kind: "ingredient" | "recipe" | "waste"; id: string; confirmText?: string }) {
  const { pending, error, run } = useRun();
  const act = kind === "ingredient" ? deleteIngredientAction : kind === "recipe" ? deleteRecipeAction : deleteWasteAction;
  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" variant="ghost" disabled={pending} aria-label={l.delete} onClick={() => { if (!confirmText || confirm(confirmText)) run(() => act({ id })); }} data-testid={`delete-${kind}`}><Spin on={pending} icon={Trash2} /></Button>
      <Msg error={error} />
    </span>
  );
}

export function SimpleAction({ l, what, id, label, testid }: { l: L; what: "import" | "refresh" | "price" | "allergens"; id?: string; label: string; testid: string }) {
  const { pending, error, done, run } = useRun();
  const go = () => run(async () => {
    if (what === "import") return importFromTillAction({});
    if (what === "refresh") return refreshCostsAction({});
    if (what === "price") return applySuggestedPriceAction({ id: id! });
    return pushAllergensAction({ id: id! });
  }, undefined, l.done);
  const Icon = what === "import" ? Download : what === "refresh" ? RefreshCw : what === "price" ? Check : Send;
  return <span className="inline-flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={go} data-testid={testid}><Spin on={pending} icon={Icon} /> {label}</Button><Msg error={error} done={done} /></span>;
}

// ── recipes ─────────────────────────────────────────────────────────────────

type Line = { key: number; ref: string; qty: string; unit: string };
type RecipeInit = {
  id: string | null; name: string; kind: "DISH" | "SUB"; category: string | null; posItemId: string | null; yieldQty: number; yieldUnit: string | null; priceGross: number | null; vatRate: number;
  ownTarget: number | null; soldPerWeek: number | null; notes: string | null; active: boolean; lineRows: { ingredientId: string | null; subRecipeId: string | null; qty: number; unit: string }[];
};

export function RecipeEditor({ l, locale, init, ingredients, subRecipes, posItems, base }: { l: L; locale: string; init: RecipeInit; ingredients: Opt[]; subRecipes: Opt[]; posItems: { id: string; name: string; price: number }[]; base: string }) {
  const { pending, error, done, run, router } = useRun();
  const [s, setS] = useState({ ...init, yieldQty: String(init.yieldQty), priceGross: init.priceGross != null ? String(init.priceGross) : "", vatRate: String(init.vatRate), ownTarget: init.ownTarget != null ? String(init.ownTarget) : "", soldPerWeek: init.soldPerWeek != null ? String(init.soldPerWeek) : "" });
  let k = 0;
  const [lines, setLines] = useState<Line[]>(init.lineRows.map((r) => ({ key: k++, ref: r.ingredientId ? `i:${r.ingredientId}` : `s:${r.subRecipeId}`, qty: String(r.qty), unit: r.unit })));
  const [next, setNext] = useState(1000);
  const set = (key: keyof typeof s, v: unknown) => setS({ ...s, [key]: v });
  const unitFor = (ref: string) => {
    const u = ref.startsWith("i:") ? ingredients.find((x) => `i:${x.id}` === ref)?.unit : subRecipes.find((x) => `s:${x.id}` === ref)?.unit;
    return u === "L" ? "ML" : u === "PCS" ? "PCS" : "G";
  };
  const addLine = () => { const ref = ingredients[0] ? `i:${ingredients[0].id}` : subRecipes[0] ? `s:${subRecipes[0].id}` : ""; if (!ref) return; setLines([...lines, { key: next, ref, qty: "", unit: unitFor(ref) }]); setNext(next + 1); };
  const pos = posItems.find((p) => p.id === s.posItemId);
  const submit = () => run(() => saveRecipeAction({
    id: init.id, name: s.name, kind: s.kind, category: s.category || null, posItemId: s.kind === "DISH" ? s.posItemId || null : null, yieldQty: Number(s.yieldQty.replace(",", ".")), yieldUnit: s.kind === "SUB" ? (s.yieldUnit as (typeof BASE_UNITS)[number]) ?? "KG" : null,
    priceGross: s.kind === "DISH" && !s.posItemId ? numOrNull(s.priceGross) : null, vatRate: Number(s.vatRate.replace(",", ".")), targetPct: numOrNull(s.ownTarget), soldPerWeek: numOrNull(s.soldPerWeek), notes: s.notes || null, active: s.active,
    lines: lines.filter((x) => x.ref).map((x) => ({ ingredientId: x.ref.startsWith("i:") ? x.ref.slice(2) : null, subRecipeId: x.ref.startsWith("s:") ? x.ref.slice(2) : null, qty: Number(x.qty.replace(",", ".")), unit: x.unit as (typeof LINE_UNITS)[number] })),
  }), (d) => { if (!init.id) router.push(`${base}/${(d as { id: string }).id}`); }, l.saved);
  return (
    <div className="space-y-5" data-testid="recipe-editor">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2"><Label className="text-xs">{l.name}</Label><Input value={s.name} onChange={(e) => set("name", e.target.value)} data-testid="rec-name" /></div>
        <div><Label className="text-xs">{l.kindLabel}</Label><Select value={s.kind} onChange={(e) => set("kind", e.target.value)} data-testid="rec-kind"><option value="DISH">{l["kind.DISH"]}</option><option value="SUB">{l["kind.SUB"]}</option></Select></div>
        <div><Label className="text-xs">{l.category}</Label><Input value={s.category ?? ""} onChange={(e) => set("category", e.target.value)} /></div>
        {s.kind === "DISH" ? (
          <>
            <div><Label className="text-xs">{l.portions}</Label><Input inputMode="decimal" value={s.yieldQty} onChange={(e) => set("yieldQty", e.target.value)} data-testid="rec-yield" /></div>
            <div className="sm:col-span-2"><Label className="text-xs">{l.tillItem}</Label><Select value={s.posItemId ?? ""} onChange={(e) => set("posItemId", e.target.value || null)} data-testid="rec-pos"><option value="">{l.noTillItem}</option>{posItems.map((p) => <option key={p.id} value={p.id}>{p.name} · {eur(p.price, locale)}</option>)}</Select></div>
            <div><Label className="text-xs">{l.priceGross}</Label><Input inputMode="decimal" value={pos ? String(pos.price) : s.priceGross} disabled={!!pos} onChange={(e) => set("priceGross", e.target.value)} data-testid="rec-price" /></div>
            <div><Label className="text-xs">{l.vatRate}</Label><Input inputMode="decimal" value={s.vatRate} onChange={(e) => set("vatRate", e.target.value)} /></div>
            <div><Label className="text-xs">{l.ownTarget}</Label><Input inputMode="decimal" value={s.ownTarget} placeholder={l.defaultTarget} onChange={(e) => set("ownTarget", e.target.value)} /></div>
            <div><Label className="text-xs">{l.soldPerWeek}</Label><Input inputMode="numeric" value={s.soldPerWeek} onChange={(e) => set("soldPerWeek", e.target.value)} /></div>
          </>
        ) : (
          <>
            <div><Label className="text-xs">{l.batchMakes}</Label><Input inputMode="decimal" value={s.yieldQty} onChange={(e) => set("yieldQty", e.target.value)} data-testid="rec-yield" /></div>
            <div><Label className="text-xs">{l.unitLabel}</Label><Select value={s.yieldUnit ?? "KG"} onChange={(e) => set("yieldUnit", e.target.value)} data-testid="rec-yield-unit">{BASE_UNITS.map((u) => <option key={u} value={u}>{l[`unit.${u}`]}</option>)}</Select></div>
          </>
        )}
      </div>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{l.lines}</h3>
        {lines.length === 0 && <p className="text-sm text-muted-foreground">{l.noLines}</p>}
        <ul className="space-y-2">
          {lines.map((x, i) => (
            <li key={x.key} className="flex flex-wrap items-end gap-2 rounded-lg border p-2" data-testid="rec-line">
              <div className="min-w-48 flex-1"><Label className="text-xs">{l.ingredient}</Label>
                <Select value={x.ref} onChange={(e) => setLines(lines.map((y, j) => (j === i ? { ...y, ref: e.target.value, unit: unitFor(e.target.value) } : y)))} data-testid="line-ref">
                  {ingredients.length > 0 && <optgroup label={l.ingredients}>{ingredients.map((o) => <option key={o.id} value={`i:${o.id}`}>{o.name}</option>)}</optgroup>}
                  {subRecipes.length > 0 && <optgroup label={l.subRecipes}>{subRecipes.map((o) => <option key={o.id} value={`s:${o.id}`}>{o.name}</option>)}</optgroup>}
                </Select>
              </div>
              <div className="w-24"><Label className="text-xs">{l.qty}</Label><Input inputMode="decimal" value={x.qty} onChange={(e) => setLines(lines.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)))} data-testid="line-qty" /></div>
              <div className="w-24"><Label className="text-xs">{l.unitLabel}</Label><Select value={x.unit} onChange={(e) => setLines(lines.map((y, j) => (j === i ? { ...y, unit: e.target.value } : y)))} data-testid="line-unit">{LINE_UNITS.map((u) => <option key={u} value={u}>{l[`lineUnit.${u}`]}</option>)}</Select></div>
              <Button size="icon" variant="ghost" aria-label={l.removeLine} onClick={() => setLines(lines.filter((_, j) => j !== i))}><X className="size-4" /></Button>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="outline" onClick={addLine} disabled={!ingredients.length && !subRecipes.length} data-testid="rec-add-line"><Plus className="size-4" /> {l.addLine}</Button>
      </section>
      <div><Label className="text-xs">{l.notes}</Label><textarea className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={s.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.active} onChange={(e) => set("active", e.target.checked)} /> {l.active}</label>
      <div className="flex flex-wrap items-center gap-2"><Button disabled={pending} onClick={submit} data-testid="rec-save"><Spin on={pending} icon={Save} /> {l.save}</Button><Msg error={error} done={done} /></div>
    </div>
  );
}

// ── what-if ─────────────────────────────────────────────────────────────────

type WhatIfRes = { ingredient: { name: string }; risePct: number; rows: { id: string; name: string; before: number | null; after: number | null; cost: number; suggested: number | null; over: boolean }[] };

export function WhatIf({ l, locale, ingredients }: { l: L; locale: string; ingredients: Opt[] }) {
  const { pending, error, run } = useRun();
  const [ing, setIng] = useState(ingredients[0]?.id ?? ""), [pct, setPct] = useState("10"), [res, setRes] = useState<WhatIfRes | null>(null);
  const pctFmt = (n: number | null) => (n == null ? "—" : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n)} %`);
  return (
    <div className="space-y-3" data-testid="what-if">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1"><Label className="text-xs">{l.ingredient}</Label><Select value={ing} onChange={(e) => setIng(e.target.value)} data-testid="whatif-ing">{ingredients.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></div>
        <div className="w-28"><Label className="text-xs">{l.risePct}</Label><Input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} data-testid="whatif-pct" /></div>
        <Button size="sm" disabled={pending || !ing} onClick={() => run(async () => { const r = await whatIfAction({ ingredientId: ing, risePct: Number(pct.replace(",", ".")) }); if (r.ok) setRes(r.data as WhatIfRes); return r; })} data-testid="whatif-run"><Spin on={pending} icon={Calculator} /> {l.calculate}</Button>
      </div>
      <Msg error={error} />
      {res && (res.rows.length === 0 ? <p className="text-sm text-muted-foreground">{l.whatIfNone}</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="whatif-table">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-2">{l.dish}</th><th className="py-1 pr-2 text-right">{l.foodCostNow}</th><th className="py-1 pr-2 text-right">{l.foodCostThen}</th><th className="py-1 text-right">{l.suggestedPrice}</th></tr></thead>
          <tbody className="divide-y">{res.rows.map((r) => <tr key={r.id}><td className="py-1.5 pr-2">{r.name}</td><td className="py-1.5 pr-2 text-right tabular-nums">{pctFmt(r.before)}</td><td className={`py-1.5 pr-2 text-right tabular-nums ${r.over ? "font-semibold text-destructive" : ""}`}>{pctFmt(r.after)}</td><td className="py-1.5 text-right tabular-nums">{eur(r.suggested, locale)}</td></tr>)}</tbody>
        </table></div>
      ))}
    </div>
  );
}

// ── waste ───────────────────────────────────────────────────────────────────

type Lot = { id: string; product: string; pack: string; lotCode: string | null; expiresOn: string; left: number };
type Rec = { id: string; name: string; kind: string; yieldUnit: string | null };

/** Phone-first: pick what (ingredient, dish, a lot, or type it), how much, why — one tap to save. */
export function WasteLogger({ l, locale, ingredients, recipes, lots, kind = "WASTE" }: { l: L; locale: string; ingredients: Opt[]; recipes: Rec[]; lots: Lot[]; kind?: "WASTE" | "DONATION" }) {
  const { pending, error, done, run } = useRun();
  const [src, setSrc] = useState<"ING" | "REC" | "LOT" | "TEXT">(lots.length && kind === "WASTE" ? "LOT" : ingredients.length ? "ING" : "TEXT");
  const [ref, setRef] = useState(""), [label, setLabel] = useState(""), [qty, setQty] = useState(""), [unit, setUnit] = useState("KG");
  const [reason, setReason] = useState<string>(""), [note, setNote] = useState(""), [recipient, setRecipient] = useState(""), [receipt, setReceipt] = useState("");
  const options = useMemo(() => (src === "ING" ? ingredients.map((o) => ({ id: o.id, label: o.name, unit: o.unit })) : src === "REC" ? recipes.map((r) => ({ id: r.id, label: r.name, unit: r.kind === "DISH" ? "PORTION" : r.yieldUnit })) : src === "LOT" ? lots.map((x) => ({ id: x.id, label: `${x.product}${x.lotCode ? ` · ${x.lotCode}` : ""} · ${new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(x.expiresOn))} · ${fill(l.left, { n: x.left })}`, unit: "PACK" })) : []), [src, ingredients, recipes, lots, locale, l]);
  const pickRef = (id: string) => {
    setRef(id);
    const o = options.find((x) => x.id === id);
    const u = o?.unit;
    setUnit(u === "PORTION" || u === "PACK" ? u : u === "L" ? "L" : u === "PCS" ? "PCS" : "KG");
  };
  const units = src === "LOT" ? ["PACK"] : src === "REC" && options.find((x) => x.id === ref)?.unit === "PORTION" ? ["PORTION"] : ["G", "KG", "ML", "L", "PCS"];
  const submit = () => run(() => logWasteAction({
    kind, reason: kind === "WASTE" ? (reason as (typeof WASTE_REASONS)[number]) || null : null, ingredientId: src === "ING" ? ref || null : null, recipeId: src === "REC" ? ref || null : null, lotId: src === "LOT" ? ref || null : null,
    label: src === "TEXT" ? label : null, qty: Number(qty.replace(",", ".")), unit: unit as never, note: note || null, recipient: kind === "DONATION" ? recipient : null, receiptRef: kind === "DONATION" ? receipt || null : null, at: null,
  }), (d) => { const r = d as { cost: number }; setQty(""); setNote(""); void r; }, l.logged);
  return (
    <div className="space-y-3" data-testid={kind === "DONATION" ? "donation-logger" : "waste-logger"}>
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {(["LOT", "ING", "REC", "TEXT"] as const).filter((x) => x !== "LOT" || lots.length).map((x) => (
          <button key={x} type="button" role="tab" aria-selected={src === x} onClick={() => { setSrc(x); setRef(""); setUnit(x === "LOT" ? "PACK" : "KG"); }} className={`rounded-full border px-3 py-1.5 text-sm ${src === x ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`} data-testid={`waste-src-${x}`}>{l[`src.${x}`]}</button>
        ))}
      </div>
      {src === "TEXT" ? (
        <div><Label className="text-xs">{l.whatWasIt}</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} data-testid="waste-label" /></div>
      ) : (
        <div><Label className="text-xs">{l[`src.${src}`]}</Label><Select value={ref} onChange={(e) => pickRef(e.target.value)} data-testid="waste-ref"><option value="">{l.choose}</option>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs">{l.qty}</Label><Input inputMode="decimal" className="h-11 text-lg" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="waste-qty" /></div>
        <div><Label className="text-xs">{l.unitLabel}</Label><Select className="h-11" value={unit} onChange={(e) => setUnit(e.target.value)} data-testid="waste-unit">{units.map((u) => <option key={u} value={u}>{l[`lineUnit.${u}`]}</option>)}</Select></div>
      </div>
      {kind === "WASTE" ? (
        <fieldset><legend className="mb-1 text-xs font-medium">{l.why}</legend>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">{WASTE_REASONS.map((r) => <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r} className={`rounded-lg border px-2 py-2 text-sm ${reason === r ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`} data-testid={`waste-reason-${r}`}>{l[`reason.${r}`]}</button>)}</div>
        </fieldset>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <div><Label className="text-xs">{l.recipient}</Label><Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={l.recipientHint} data-testid="don-recipient" /></div>
          <div><Label className="text-xs">{l.receiptRef}</Label><Input value={receipt} onChange={(e) => setReceipt(e.target.value)} /></div>
        </div>
      )}
      <div><Label className="text-xs">{l.note}</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <Button size="lg" className="w-full sm:w-auto" disabled={pending || !qty || (src !== "TEXT" && !ref)} onClick={submit} data-testid="waste-save"><Spin on={pending} icon={Plus} /> {kind === "DONATION" ? l.logDonation : l.logWaste}</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

// ── the business's own targets ─────────────────────────────────────────────

export function ProfileForm({ l, own, defaults }: { l: L; own: { targetFoodCostPct: number | null; wasteTargetPct: number | null; costBasis: string | null; rounding: string | null }; defaults: { targetFoodCostPct: number; wasteTargetPct: number; costBasis: string; rounding: string } }) {
  const { pending, error, done, run } = useRun();
  const [t, setT] = useState(own.targetFoodCostPct != null ? String(own.targetFoodCostPct) : ""), [w, setW] = useState(own.wasteTargetPct != null ? String(own.wasteTargetPct) : "");
  const [b, setB] = useState(own.costBasis ?? ""), [r, setR] = useState(own.rounding ?? "");
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="kitchen-profile">
      <div><Label className="text-xs">{l.targetFoodCost}</Label><Input inputMode="decimal" value={t} placeholder={String(defaults.targetFoodCostPct)} onChange={(e) => setT(e.target.value)} data-testid="prof-target" /></div>
      <div><Label className="text-xs">{l.wasteTarget}</Label><Input inputMode="decimal" value={w} placeholder={String(defaults.wasteTargetPct)} onChange={(e) => setW(e.target.value)} /></div>
      <div><Label className="text-xs">{l.costBasisLabel}</Label><Select value={b} onChange={(e) => setB(e.target.value)}><option value="">{fill(l.byDefault, { v: l[`basis.${defaults.costBasis}`] })}</option>{COST_BASES.map((x) => <option key={x} value={x}>{l[`basis.${x}`]}</option>)}</Select></div>
      <div><Label className="text-xs">{l.roundingLabel}</Label><Select value={r} onChange={(e) => setR(e.target.value)}><option value="">{fill(l.byDefault, { v: l[`rounding.${defaults.rounding}`] })}</option>{ROUNDINGS.map((x) => <option key={x} value={x}>{l[`rounding.${x}`]}</option>)}</Select></div>
      <div className="flex items-end gap-2"><Button size="sm" disabled={pending} onClick={() => run(() => saveKitchenProfileAction({ targetFoodCostPct: numOrNull(t), wasteTargetPct: numOrNull(w), costBasis: (b || null) as never, rounding: (r || null) as never }), undefined, l.saved)} data-testid="prof-save"><Spin on={pending} icon={Save} /> {l.save}</Button><Msg error={error} done={done} /></div>
    </div>
  );
}
