"use client";
/** Rebates & bonuses (Phase 48) — the deal form (supplier and FIRINGI), buttons, the buyer's progress bars. Texts come in as `l`. */
import { useEffect, useMemo, useState } from "react";
import { Ban, Check, Plus, Search, Send, ShoppingCart, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { addToCartAction } from "@/server/actions/orders";
import { bonusOptionsAction, endBonusAction, saveBonusAction, searchCustomersAction, submitBonusAction } from "@/server/actions/rebates";
import { evaluate, type RebateRules } from "@/lib/rebates";

export type L = Record<string, string>;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const money = (n: number, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);

export type FormOptions = {
  offers: { id: string; label: string; sku: string }[]; groups: { id: string; name: string; own: boolean }[]; segments: { id: string; name: string }[];
  categories: { id: string; name: string; depth: number }[]; brands: { id: string; name: string }[]; countries: { code: string; name: string; flag: string | null }[];
};
export type Allowed = { kinds: string[]; periods: string[]; audiences: string[]; country: boolean; perShop: boolean; maxPct: number; freeGoodsDays: number; auto: boolean };
export type Initial = {
  id: string; sellerCompanyId: string; name: string; description: string | null; kind: string; period: string; rules: Record<string, unknown>; validFrom: string; validTo: string | null;
  audience: string; segmentId: string | null; groupId: string | null; companies: { id: string; name: string }[]; countries: string[]; perShop: boolean;
  offerIds: string[]; categoryIds: string[]; brandIds: string[]; rewardOfferId: string | null; freeGoodsDays: number;
};

const today = () => new Date().toISOString().slice(0, 10);
const numOr = (v: string, d: number | null = null) => (v.trim() === "" ? d : Number(v));

/** A searchable list of checkboxes (phone friendly). */
function PickList({ l, items, value, onChange, testid }: { l: L; items: { id: string; label: string; indent?: number }[]; value: string[]; onChange: (v: string[]) => void; testid: string }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => items.filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase())).slice(0, 300), [items, q]);
  const set = new Set(value);
  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-2 border-b px-2">
        <Search className="size-4 text-muted-foreground" />
        <input className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder={l["f.search"]} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="shrink-0 text-xs text-muted-foreground">{f(l["f.selected"], { n: value.length })}</span>
      </div>
      <ul className="max-h-48 overflow-y-auto p-1" data-testid={testid}>
        {shown.map((i) => (
          <li key={i.id}>
            <label className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-sm hover:bg-muted/60" style={{ paddingLeft: 8 + (i.indent ?? 0) * 12 }}>
              <input type="checkbox" className="mt-0.5" checked={set.has(i.id)} onChange={(e) => onChange(e.target.checked ? [...value, i.id] : value.filter((x) => x !== i.id))} />
              <span className="min-w-0 break-words">{i.label}</span>
            </label>
          </li>
        ))}
        {!shown.length && <li className="px-2 py-2 text-xs text-muted-foreground">{l["f.noMatch"]}</li>}
      </ul>
    </div>
  );
}

/** Find customers by name / NIF and keep the chosen ones as chips. */
function CustomerPicker({ l, value, onChange }: { l: L; value: { id: string; name: string }[]; onChange: (v: { id: string; name: string }[]) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; name: string; country: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => { const r = await searchCustomersAction({ q }); if (r.ok) setHits(r.data as typeof hits); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-2">
      <Input placeholder={l["f.findCustomer"]} value={q} onChange={(e) => setQ(e.target.value)} data-testid="rb-customer-search" />
      {hits.length > 0 && (
        <ul className="max-h-40 overflow-y-auto rounded-lg border p-1 text-sm">
          {hits.filter((h) => !value.some((v) => v.id === h.id)).map((h) => (
            <li key={h.id}><button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-muted/60" onClick={() => { onChange([...value, { id: h.id, name: h.name }]); setQ(""); }} data-testid="rb-customer-hit">{h.name} <span className="text-xs text-muted-foreground">{h.country}</span></button></li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5">
        {value.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">{c.name}<button type="button" aria-label={l["f.remove"]} onClick={() => onChange(value.filter((x) => x.id !== c.id))}><X className="size-3" /></button></span>
        ))}
      </div>
    </div>
  );
}

type Tier = { a: string; b: string };

export function RebateForm({ l, locale, allowed, options: initialOptions, initial, suppliers, detailBase }: {
  l: L; locale: string; allowed: Allowed; options: FormOptions; initial?: Initial | null;
  /** FIRINGI: choose the supplier whose goods count (FIRINGI-funded deal) */
  suppliers?: { id: string; name: string }[];
  /** where to go after saving, e.g. "/vendor/products/rebates" */
  detailBase: string;
}) {
  const { pending, error, done, run, router } = useRun();
  const r = (initial?.rules ?? {}) as Record<string, unknown>;
  const [options, setOptions] = useState(initialOptions);
  const [seller, setSeller] = useState(initial?.sellerCompanyId ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [kind, setKind] = useState(initial?.kind ?? allowed.kinds[0] ?? "VOLUME");
  const [period, setPeriod] = useState(initial?.period ?? (allowed.periods.includes("QUARTER") ? "QUARTER" : allowed.periods[0] ?? "MONTH"));
  const [validFrom, setValidFrom] = useState(initial?.validFrom ?? today());
  const [validTo, setValidTo] = useState(initial?.validTo ?? "");
  // VOLUME
  const [basis, setBasis] = useState((r.basis as string) ?? "AMOUNT");
  const [retro, setRetro] = useState(r.retro !== false);
  const [tiers, setTiers] = useState<Tier[]>(() => (kind === "VOLUME" && Array.isArray(r.tiers) ? (r.tiers as { from: number; pct: number }[]).map((t) => ({ a: String(t.from), b: String(t.pct) })) : [{ a: "1000", b: "2" }, { a: "5000", b: "3" }]));
  // GROWTH
  const [gTiers, setGTiers] = useState<Tier[]>(() => (kind === "GROWTH" && Array.isArray(r.tiers) ? (r.tiers as { growthPct: number; pct: number }[]).map((t) => ({ a: String(t.growthPct), b: String(t.pct) })) : [{ a: "10", b: "2" }]));
  const [base, setBase] = useState((r.base as string) ?? "INCREASE");
  const [minPrevious, setMinPrevious] = useState(r.minPrevious != null ? String(r.minPrevious) : "0");
  // FREE_GOODS
  const [buyUnits, setBuyUnits] = useState(r.buyUnits != null ? String(r.buyUnits) : "10");
  const [freeUnits, setFreeUnits] = useState(r.freeUnits != null ? String(r.freeUnits) : "1");
  const [maxFree, setMaxFree] = useState(r.maxFreePerPeriod != null ? String(r.maxFreePerPeriod) : "");
  const [rewardOfferId, setRewardOfferId] = useState(initial?.rewardOfferId ?? "");
  const [freeDays, setFreeDays] = useState(String(initial?.freeGoodsDays ?? allowed.freeGoodsDays));
  // MIX
  const [minDistinct, setMinDistinct] = useState(r.minDistinct != null ? String(r.minDistinct) : "5");
  const [minUnitsEach, setMinUnitsEach] = useState(r.minUnitsEach != null ? String(r.minUnitsEach) : "1");
  const [rewardFixed, setRewardFixed] = useState(r.rewardFixed != null ? String(r.rewardFixed) : "50");
  const [rewardPct, setRewardPct] = useState(r.rewardPct != null ? String(r.rewardPct) : "");
  // scope & audience
  const [some, setSome] = useState(!!(initial && (initial.offerIds.length || initial.categoryIds.length || initial.brandIds.length)));
  const [offerIds, setOfferIds] = useState(initial?.offerIds ?? []);
  const [categoryIds, setCategoryIds] = useState(initial?.categoryIds ?? []);
  const [brandIds, setBrandIds] = useState(initial?.brandIds ?? []);
  const [audience, setAudience] = useState(initial?.audience ?? allowed.audiences[0] ?? "ALL");
  const [segmentId, setSegmentId] = useState(initial?.segmentId ?? "");
  const [groupId, setGroupId] = useState(initial?.groupId ?? "");
  const [companies, setCompanies] = useState(initial?.companies ?? []);
  const [countries, setCountries] = useState(initial?.countries ?? []);
  const [perShop, setPerShop] = useState(initial?.perShop ?? false);
  // try it
  const [tryA, setTryA] = useState("6000"), [tryU, setTryU] = useState("25"), [tryP, setTryP] = useState("5000"), [tryD, setTryD] = useState("5");

  useEffect(() => {
    if (!suppliers || !seller) return;
    void bonusOptionsAction({ sellerId: seller }).then((res) => { if (res.ok) setOptions(res.data as FormOptions); });
  }, [seller, suppliers]);

  const rules = useMemo((): Record<string, unknown> => {
    if (kind === "VOLUME") return { kind, basis, retro, tiers: tiers.filter((t) => t.a !== "" && t.b !== "").map((t) => ({ from: Number(t.a), pct: Number(t.b) })) };
    if (kind === "GROWTH") return { kind, base, minPrevious: numOr(minPrevious, 0), tiers: gTiers.filter((t) => t.a !== "" && t.b !== "").map((t) => ({ growthPct: Number(t.a), pct: Number(t.b) })) };
    if (kind === "FREE_GOODS") return { kind, buyUnits: Number(buyUnits), freeUnits: Number(freeUnits), maxFreePerPeriod: numOr(maxFree) };
    return { kind, minDistinct: Number(minDistinct), minUnitsEach: Number(minUnitsEach), rewardFixed: numOr(rewardFixed), rewardPct: numOr(rewardPct) };
  }, [kind, basis, retro, tiers, base, minPrevious, gTiers, buyUnits, freeUnits, maxFree, minDistinct, minUnitsEach, rewardFixed, rewardPct]);

  const trial = useMemo(() => {
    try {
      const n = Number(tryD) || 0;
      const per = Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, Math.max(1, Number(minUnitsEach) || 1)]));
      return evaluate(rules as RebateRules, { amount: Number(tryA) || 0, units: Number(tryU) || 0, previousAmount: Number(tryP) || 0, distinct: n, perProductUnits: per });
    } catch { return null; }
  }, [rules, tryA, tryU, tryP, tryD, minUnitsEach]);

  const save = (submit: boolean) => run(
    () => saveBonusAction({
      id: initial?.id ?? null, sellerCompanyId: suppliers ? seller : null, name, description: description || null, kind: kind as "VOLUME", period: period as "MONTH", rules,
      validFrom, validTo: validTo || null, audience: audience as "ALL", segmentId: segmentId || null, groupId: groupId || null, companyIds: companies.map((c) => c.id),
      countries, perShop, offerIds: some ? offerIds : [], categoryIds: some ? categoryIds : [], brandIds: some ? brandIds : [],
      rewardOfferId: kind === "FREE_GOODS" ? rewardOfferId || null : null, freeGoodsDays: Number(freeDays) || null, submit,
    }),
    (d) => router.push(`${detailBase}/${(d as { id: string }).id}`),
    submit ? (allowed.auto ? l["f.started"] : l["f.sent"]) : l["f.saved"],
  );

  const tierRows = (rows: Tier[], set: (v: Tier[]) => void, aLabel: string, bLabel: string, testid: string) => (
    <div className="space-y-2" data-testid={testid}>
      {rows.map((t, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <div className="w-32"><Label className="text-xs">{aLabel}</Label><Input type="number" min={0} step="any" value={t.a} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} data-testid={`${testid}-a`} /></div>
          <div className="w-24"><Label className="text-xs">{bLabel}</Label><Input type="number" min={0} max={allowed.maxPct} step="any" value={t.b} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, b: e.target.value } : x)))} data-testid={`${testid}-b`} /></div>
          {rows.length > 1 && <Button type="button" variant="ghost" size="sm" aria-label={l["f.remove"]} onClick={() => set(rows.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>}
        </div>
      ))}
      {rows.length < 6 && <Button type="button" variant="outline" size="sm" onClick={() => set([...rows, { a: "", b: "" }])}><Plus className="size-4" /> {l["f.addTier"]}</Button>}
      <p className="text-xs text-muted-foreground">{f(l.maxPct, { pct: allowed.maxPct })}</p>
    </div>
  );

  const cats = options.categories.map((c) => ({ id: c.id, label: c.name, indent: c.depth }));
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save(false); }} data-testid="rebate-form">
      {suppliers && (
        <div className="max-w-md"><Label htmlFor="rb-seller">Supplier whose goods count</Label>
          <Select id="rb-seller" value={seller} onChange={(e) => setSeller(e.target.value)} required data-testid="rb-seller"><option value="">{l["f.chooseOne"]}</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="rb-name">{l["f.name"]}</Label><Input id="rb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={l["f.namePh"]} maxLength={120} required data-testid="rb-name" /></div>
        <div><Label htmlFor="rb-desc">{l["f.description"]}</Label><Input id="rb-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} /></div>
        <div><Label htmlFor="rb-kind">{l["f.kind"]}</Label>
          <Select id="rb-kind" value={kind} onChange={(e) => setKind(e.target.value)} data-testid="rb-kind">{allowed.kinds.map((k) => <option key={k} value={k}>{l[`kind.${k}`]}</option>)}</Select>
          <p className="mt-1 text-xs text-muted-foreground">{l[`kindHint.${kind}`]}</p>
        </div>
        <div><Label htmlFor="rb-period">{l["f.period"]}</Label>
          <Select id="rb-period" value={period} onChange={(e) => setPeriod(e.target.value)} data-testid="rb-period">{allowed.periods.map((p) => <option key={p} value={p}>{l[`period.${p}`]}</option>)}</Select>
        </div>
        <div><Label htmlFor="rb-from">{l["f.starts"]}</Label><Input id="rb-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} required data-testid="rb-from" /></div>
        <div><Label htmlFor="rb-to">{l["f.ends"]}</Label><Input id="rb-to" type="date" value={validTo} min={validFrom} onChange={(e) => setValidTo(e.target.value)} data-testid="rb-to" />{!validTo && <p className="mt-1 text-xs text-muted-foreground">{l["f.noEnd"]}</p>}</div>
      </div>

      <fieldset className="space-y-3 rounded-xl border p-3 sm:p-4">
        <legend className="px-1 text-sm font-medium">{l[`kind.${kind}`]}</legend>
        {kind === "VOLUME" && (
          <>
            <div className="max-w-xs"><Label htmlFor="rb-basis">{l["f.basis"]}</Label><Select id="rb-basis" value={basis} onChange={(e) => setBasis(e.target.value)}><option value="AMOUNT">{l["f.basisAMOUNT"]}</option><option value="UNITS">{l["f.basisUNITS"]}</option></Select></div>
            {tierRows(tiers, setTiers, l["f.from"], l["f.pct"], "rb-tiers")}
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={retro} onChange={(e) => setRetro(e.target.checked)} /><span>{l["f.retro"]}<span className="block text-xs text-muted-foreground">{l["f.retroHint"]}</span></span></label>
          </>
        )}
        {kind === "GROWTH" && (
          <>
            {tierRows(gTiers, setGTiers, l["f.growthPct"], l["f.bonusPct"], "rb-gtiers")}
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="rb-base">{l["f.base"]}</Label><Select id="rb-base" value={base} onChange={(e) => setBase(e.target.value)}><option value="INCREASE">{l["f.baseINCREASE"]}</option><option value="TOTAL">{l["f.baseTOTAL"]}</option></Select></div>
              <div><Label htmlFor="rb-minprev">{l["f.minPrevious"]}</Label><Input id="rb-minprev" type="number" min={0} step="any" value={minPrevious} onChange={(e) => setMinPrevious(e.target.value)} /><p className="mt-1 text-xs text-muted-foreground">{l["f.minPreviousHint"]}</p></div>
            </div>
          </>
        )}
        {kind === "FREE_GOODS" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="rb-buy">{l["f.buyUnits"]}</Label><Input id="rb-buy" type="number" min={1} step={1} value={buyUnits} onChange={(e) => setBuyUnits(e.target.value)} data-testid="rb-buy" /></div>
            <div><Label htmlFor="rb-free">{l["f.freeUnits"]}</Label><Input id="rb-free" type="number" min={1} step={1} value={freeUnits} onChange={(e) => setFreeUnits(e.target.value)} data-testid="rb-free" /></div>
            <div><Label htmlFor="rb-maxfree">{l["f.maxFree"]}</Label><Input id="rb-maxfree" type="number" min={1} step={1} value={maxFree} onChange={(e) => setMaxFree(e.target.value)} /></div>
            <div><Label htmlFor="rb-days">{l["f.freeGoodsDays"]}</Label><Input id="rb-days" type="number" min={7} max={365} value={freeDays} onChange={(e) => setFreeDays(e.target.value)} /></div>
            <div className="sm:col-span-2"><Label htmlFor="rb-reward">{l["f.rewardOffer"]}</Label>
              <Select id="rb-reward" value={rewardOfferId} onChange={(e) => setRewardOfferId(e.target.value)} data-testid="rb-reward"><option value="">{l["f.chooseProduct"]}</option>{options.offers.map((o) => <option key={o.id} value={o.id}>{o.label} ({o.sku})</option>)}</Select>
            </div>
          </div>
        )}
        {kind === "MIX" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="rb-distinct">{l["f.minDistinct"]}</Label><Input id="rb-distinct" type="number" min={1} step={1} value={minDistinct} onChange={(e) => setMinDistinct(e.target.value)} data-testid="rb-distinct" /></div>
            <div><Label htmlFor="rb-each">{l["f.minUnitsEach"]}</Label><Input id="rb-each" type="number" min={1} step={1} value={minUnitsEach} onChange={(e) => setMinUnitsEach(e.target.value)} /></div>
            <div><Label htmlFor="rb-fixed">{l["f.rewardFixed"]}</Label><Input id="rb-fixed" type="number" min={0} step="any" value={rewardFixed} onChange={(e) => setRewardFixed(e.target.value)} data-testid="rb-fixed" /></div>
            <div><Label htmlFor="rb-rpct">{l["f.rewardPct"]}</Label><Input id="rb-rpct" type="number" min={0} max={allowed.maxPct} step="any" value={rewardPct} onChange={(e) => setRewardPct(e.target.value)} /></div>
          </div>
        )}
        <div className="rounded-lg bg-muted/40 p-3 text-sm" data-testid="rb-try">
          <p className="mb-2 font-medium">{l.tryIt}</p>
          <div className="flex flex-wrap gap-2">
            {(kind === "VOLUME" || kind === "GROWTH" || kind === "MIX") && <label className="w-32 text-xs">{l.tryAmount}<Input type="number" value={tryA} onChange={(e) => setTryA(e.target.value)} className="h-8" /></label>}
            {(kind === "FREE_GOODS" || (kind === "VOLUME" && basis === "UNITS")) && <label className="w-32 text-xs">{l.tryUnits}<Input type="number" value={tryU} onChange={(e) => setTryU(e.target.value)} className="h-8" /></label>}
            {kind === "GROWTH" && <label className="w-32 text-xs">{l.tryPrev}<Input type="number" value={tryP} onChange={(e) => setTryP(e.target.value)} className="h-8" /></label>}
            {kind === "MIX" && <label className="w-32 text-xs">{l.tryDistinct}<Input type="number" value={tryD} onChange={(e) => setTryD(e.target.value)} className="h-8" /></label>}
          </div>
          {trial && <p className="mt-2 font-medium" data-testid="rb-try-result">{kind === "FREE_GOODS" ? f(l.tryFree, { n: trial.freeUnits }) : f(l.tryResult, { value: money(trial.value, locale) })}</p>}
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border p-3 sm:p-4">
        <legend className="px-1 text-sm font-medium">{l["f.products"]}</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={!some} onChange={() => setSome(false)} /> {l["f.allProducts"]}</label>
          <label className="flex items-center gap-2"><input type="radio" checked={some} onChange={() => setSome(true)} data-testid="rb-some" /> {l["f.someProducts"]}</label>
        </div>
        {some && (
          <div className="grid gap-3 lg:grid-cols-3">
            <div><Label>{l["f.offers"]}</Label><PickList l={l} items={options.offers.map((o) => ({ id: o.id, label: `${o.label} (${o.sku})` }))} value={offerIds} onChange={setOfferIds} testid="rb-offers" /></div>
            <div><Label>{l["f.categories"]}</Label><PickList l={l} items={cats} value={categoryIds} onChange={setCategoryIds} testid="rb-categories" /></div>
            <div><Label>{l["f.brands"]}</Label><PickList l={l} items={options.brands.map((b) => ({ id: b.id, label: b.name }))} value={brandIds} onChange={setBrandIds} testid="rb-brands" /></div>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border p-3 sm:p-4">
        <legend className="px-1 text-sm font-medium">{l["f.audience"]}</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {allowed.audiences.map((a) => <label key={a} className="flex items-center gap-2"><input type="radio" name="rb-audience" checked={audience === a} onChange={() => setAudience(a)} data-testid={`rb-aud-${a}`} /> {l[`audience.${a}`]}</label>)}
        </div>
        {audience === "SEGMENT" && <div className="max-w-md"><Label htmlFor="rb-seg">{l["f.segment"]}</Label><Select id="rb-seg" value={segmentId} onChange={(e) => setSegmentId(e.target.value)}><option value="">{l["f.chooseOne"]}</option>{options.segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>}
        {audience === "GROUP" && <div className="max-w-md"><Label htmlFor="rb-grp">{l["f.group"]}</Label><Select id="rb-grp" value={groupId} onChange={(e) => setGroupId(e.target.value)}><option value="">{l["f.chooseOne"]}</option>{options.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></div>}
        {audience === "COMPANIES" && <CustomerPicker l={l} value={companies} onChange={setCompanies} />}
        {allowed.country && (
          <div>
            <Label>{l["f.countries"]}</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {options.countries.map((c) => {
                const on = countries.includes(c.code);
                return <button key={c.code} type="button" onClick={() => setCountries(on ? countries.filter((x) => x !== c.code) : [...countries, c.code])} className={`rounded-full border px-2 py-0.5 text-xs ${on ? "border-primary bg-primary/10 text-primary" : ""}`} aria-pressed={on}>{c.flag} {c.code}</button>;
              })}
            </div>
            {!countries.length && <p className="mt-1 text-xs text-muted-foreground">{l["f.allCountries"]}</p>}
          </div>
        )}
        {allowed.perShop && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={perShop} onChange={(e) => setPerShop(e.target.checked)} /><span>{l["f.perShop"]}<span className="block text-xs text-muted-foreground">{l["f.perShopHint"]}</span></span></label>}
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" disabled={pending} data-testid="rb-save"><Spin on={pending} icon={Check} /> {l["f.saveDraft"]}</Button>
        <Button type="button" disabled={pending} onClick={() => save(true)} data-testid="rb-send"><Spin on={pending} icon={Send} /> {allowed.auto ? l["f.start"] : l["f.send"]}</Button>
      </div>
      <Msg error={error} done={done} />
    </form>
  );
}

export function SubmitBonus({ l, id, auto }: { l: L; id: string; auto: boolean }) {
  const { pending, error, done, run } = useRun();
  return <div className="space-y-1"><Button size="sm" disabled={pending} onClick={() => run(() => submitBonusAction({ id }), undefined, auto ? l["f.started"] : l["f.sent"])} data-testid="rb-submit"><Spin on={pending} icon={Send} /> {auto ? l["f.start"] : l["f.send"]}</Button><Msg error={error} done={done} /></div>;
}

export function EndBonus({ l, id, running }: { l: L; id: string; running: boolean }) {
  const { pending, error, run } = useRun();
  return (
    <div className="space-y-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => { if (!running || window.confirm(l.endConfirm)) run(() => endBonusAction({ id })); }} data-testid="rb-end"><Spin on={pending} icon={Ban} /> {running ? l.end : l.cancel}</Button>
      <Msg error={error} />
    </div>
  );
}

/** The buyer's progress bar (fills on load; reduced-motion safe). */
export function BonusBar({ pct, label, testid }: { pct: number; label: string; testid?: string }) {
  const [w, setW] = useState(0);
  useEffect(() => { const t = requestAnimationFrame(() => setW(Math.max(0, Math.min(100, pct)))); return () => cancelAnimationFrame(t); }, [pct]);
  return (
    <div className="space-y-1" data-testid={testid} data-progress={pct}>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
        <div className="h-full rounded-full bg-gradient-to-r from-primary to-[color:var(--success,#16a34a)] transition-[width] duration-1000 ease-out motion-reduce:transition-none" style={{ width: `${w}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function AddFreeToCart({ l, offerId, qty }: { l: L; offerId: string; qty: number }) {
  const { pending, error, done, run } = useRun();
  return (
    <div className="space-y-1">
      <Button size="sm" disabled={pending || qty < 1} onClick={() => run(() => addToCartAction({ offerId, qty }), undefined, l.added)} data-testid="rb-free-add"><Spin on={pending} icon={ShoppingCart} /> {l.addToCart}</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

