"use client";
/** Replacements (Phase 60) — interactive parts (texts passed in as `l`; the FIRINGI settings form is in English). */
import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Repeat, Save, Send, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  boughtProductsAction, decideSubstitutionAction, ownOffersAction, proposeSubstitutionAction, saveSubstitutionPreferencesAction, saveSubstitutionSettingsAction,
  setSubstituteLinksAction, setSubstitutionProductRuleAction, substituteLinksAction, substitutionCandidatesAction, withdrawSubstitutionAction,
} from "@/server/actions/substitutions";
import { matchedUnitPrice, priceDiffPct, type SubstitutionModeT, type SubstitutionSettings } from "@/lib/substitutions";

export type L = Record<string, string>;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const eur = (n: number, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
const pct = (n: number, locale: string) => `${n > 0 ? "+" : ""}${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n)} %`;
const Check2 = ({ id, checked, onChange, label, testid }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; testid?: string }) => (
  <label htmlFor={id} className="flex items-start gap-2 text-sm"><input id={id} type="checkbox" className="mt-0.5 size-4 accent-[color:var(--primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /> <span>{label}</span></label>
);

// ── customer ────────────────────────────────────────────────────────────────

export function DecideButtons({ l, id }: { l: L; id: string }) {
  const { pending, error, done, run } = useRun();
  const [which, setWhich] = useState<boolean | null>(null);
  const go = (accept: boolean) => { setWhich(accept); run(() => decideSubstitutionAction({ id, accept }), undefined, accept ? l.accepted : l.rejected); };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => go(true)} disabled={pending} data-testid="sub-accept"><Spin on={pending && which === true} icon={Check} /> {l.accept}</Button>
        <Button size="sm" variant="outline" onClick={() => go(false)} disabled={pending} data-testid="sub-reject"><Spin on={pending && which === false} icon={X} /> {l.reject}</Button>
      </div>
      <Msg error={error} done={done} />
    </div>
  );
}

export function PreferencesForm({ l, rule, allowAuto }: { l: L; rule: { mode: SubstitutionModeT; maxPricePct: number; sameBrandOnly: boolean; acceptOnTimeout: boolean }; allowAuto: boolean }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(rule);
  return (
    <div className="space-y-4" data-testid="sub-prefs">
      <div className="space-y-1 sm:max-w-sm">
        <Label htmlFor="sub-mode">{l.modeLabel}</Label>
        <Select id="sub-mode" value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as SubstitutionModeT })} data-testid="sub-mode">
          {(["ASK", "AUTO", "NEVER"] as const).map((m) => <option key={m} value={m}>{l[`mode.${m}`]}</option>)}
        </Select>
      </div>
      {v.mode === "AUTO" && !allowAuto && <p className="text-sm text-muted-foreground">{l.autoOff}</p>}
      {v.mode === "AUTO" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="sub-pct">{l.maxPricePct}</Label><Input id="sub-pct" inputMode="numeric" value={String(v.maxPricePct)} onChange={(e) => setV({ ...v, maxPricePct: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} data-testid="sub-pct" /></div>
          <div className="flex items-end pb-2"><Check2 id="sub-brand" checked={v.sameBrandOnly} onChange={(x) => setV({ ...v, sameBrandOnly: x })} label={l.sameBrandOnly} /></div>
        </div>
      )}
      {v.mode !== "NEVER" && <Check2 id="sub-timeout" checked={v.acceptOnTimeout} onChange={(x) => setV({ ...v, acceptOnTimeout: x })} label={l.acceptOnTimeout} testid="sub-timeout" />}
      <div className="flex items-center gap-3">
        <Button onClick={() => run(() => saveSubstitutionPreferencesAction(v), undefined, l.saved)} disabled={pending} data-testid="sub-save"><Spin on={pending} icon={Save} /> {l.save}</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function ProductRules({ l, rows }: { l: L; rows: { productId: string; name: string; brand: string | null; mode: SubstitutionModeT }[] }) {
  const { pending, error, run } = useRun();
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<{ id: string; name: string; brand: string | null }[]>([]);
  const [pick, setPick] = useState("");
  const [mode, setMode] = useState<SubstitutionModeT>("NEVER");
  const [, start] = useTransition();
  useEffect(() => {
    const t = setTimeout(() => start(async () => { const r = await boughtProductsAction({ q }); if (r.ok) setOpts(r.data as typeof opts); }), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-4" data-testid="sub-products">
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{l.noProducts}</p> : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.productId} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="sub-product-rule">
              <span className="min-w-0 flex-1 basis-48 break-words font-medium">{r.name}{r.brand && <span className="font-normal text-muted-foreground"> · {r.brand}</span>}</span>
              <Select aria-label={l.modeLabel} value={r.mode} className="w-auto max-w-full" onChange={(e) => run(() => setSubstitutionProductRuleAction({ productId: r.productId, mode: e.target.value as SubstitutionModeT }))}>
                {(["ASK", "AUTO", "NEVER"] as const).map((m) => <option key={m} value={m}>{l[`mode.${m}`]}</option>)}
              </Select>
              <Button size="sm" variant="ghost" onClick={() => run(() => setSubstitutionProductRuleAction({ productId: r.productId, mode: null }))} disabled={pending} aria-label={l.remove}><Trash2 className="size-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex min-w-0 flex-wrap gap-2 [&>*]:min-w-0">
        <Input className="flex-1 basis-48" placeholder={l.searchProducts} value={q} onChange={(e) => setQ(e.target.value)} aria-label={l.searchProducts} />
        <Select className="flex-1 basis-48" value={pick} onChange={(e) => setPick(e.target.value)} aria-label={l.searchProducts} data-testid="sub-product-pick">
          <option value="">—</option>
          {opts.filter((o) => !rows.some((r) => r.productId === o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}{o.brand ? ` · ${o.brand}` : ""}</option>)}
        </Select>
        <Select value={mode} onChange={(e) => setMode(e.target.value as SubstitutionModeT)} aria-label={l.modeLabel} className="w-auto max-w-full">
          {(["NEVER", "ASK", "AUTO"] as const).map((m) => <option key={m} value={m}>{l[`mode.${m}`]}</option>)}
        </Select>
        <Button onClick={() => pick && run(() => setSubstitutionProductRuleAction({ productId: pick, mode }), () => setPick(""))} disabled={!pick || pending} data-testid="sub-product-add"><Spin on={pending} icon={Plus} /> {l.add}</Button>
      </div>
      <Msg error={error} />
    </div>
  );
}

// ── supplier ────────────────────────────────────────────────────────────────

type Candidates = {
  enabled: boolean; allowPriceMatch: boolean; rule: { mode: SubstitutionModeT; maxPricePct: number; sameBrandOnly: boolean };
  line: { id: string; name: string; sku: string; unitNet: number; qty: number; alreadyShort: number; pending: boolean; isSubstitute: boolean };
  candidates: { offerId: string; linked: boolean; name: string; brand: string | null; sku: string; packaging: string; unitNet: number; available: number; sameBrand: boolean }[];
};

/** On the supplier's order page: choose the short line, then the replacement. */
export function ProposeForm({ l, locale, lines }: { l: L; locale: string; lines: { id: string; name: string; qty: number }[] }) {
  const { pending, error, done, run } = useRun();
  const [lineId, setLineId] = useState(lines.length === 1 ? lines[0].id : "");
  const [c, setC] = useState<Candidates | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [v, setV] = useState({ offerId: "", shortQty: 1, qty: 1, priceMatch: false, note: "" });
  const [loading, start] = useTransition();
  useEffect(() => {
    setC(null); setLoadErr(null);
    if (!lineId) return;
    start(async () => {
      const r = await substitutionCandidatesAction({ lineId });
      if (!r.ok) { setLoadErr(r.error ?? "Error"); return; }
      const d = r.data as Candidates;
      setC(d);
      setV((x) => ({ ...x, offerId: d.candidates[0]?.offerId ?? "", shortQty: Math.max(1, d.line.alreadyShort || 1), qty: 1, priceMatch: false }));
    });
  }, [lineId]);
  const cand = c?.candidates.find((x) => x.offerId === v.offerId);
  const preview = useMemo(() => {
    if (!c || !cand) return null;
    const orig = { unitNet: c.line.unitNet, qty: v.shortQty };
    const unit = v.priceMatch ? matchedUnitPrice(orig, { unitNet: cand.unitNet, qty: v.qty }) : cand.unitNet;
    return { was: orig.unitNet * orig.qty, now: unit * v.qty, diff: priceDiffPct(orig, { unitNet: unit, qty: v.qty }) };
  }, [c, cand, v.shortQty, v.qty, v.priceMatch]);
  const ruleText = c ? (c.rule.mode === "AUTO" ? `${f(l.ruleAUTO, { pct: c.rule.maxPricePct })}${c.rule.sameBrandOnly ? ` ${l.ruleBrand}` : ""}` : l[`rule${c.rule.mode}`]) : "";
  const [autoMsg, setAutoMsg] = useState<string | null>(null);
  const send = () => {
    setAutoMsg(null);
    run(() => proposeSubstitutionAction({ lineId, shortQty: v.shortQty, substituteOfferId: v.offerId, qty: v.qty, priceMatch: v.priceMatch, note: v.note.trim() || null }), (d) => {
      if ((d as { auto: boolean }).auto) setAutoMsg(l.sentAuto);
      setLineId("");
      setV({ offerId: "", shortQty: 1, qty: 1, priceMatch: false, note: "" });
    }, l.sent);
  };
  return (
    <div className="space-y-3 rounded-lg border p-3" data-testid="sub-propose">
      <p className="flex items-center gap-2 text-sm font-medium"><Repeat className="size-4" /> {l.offerTitle}</p>
      <div className="space-y-1 sm:max-w-md">
        <Label htmlFor="sub-line">{l.line}</Label>
        <Select id="sub-line" value={lineId} onChange={(e) => setLineId(e.target.value)} data-testid="sub-line">
          <option value="">{l.chooseLine}</option>
          {lines.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.qty}</option>)}
        </Select>
      </div>
      {loading && <p className="text-sm text-muted-foreground">…</p>}
      {loadErr && <p className="text-sm text-destructive">{loadErr}</p>}
      {c && (
        <>
          <p className="text-sm text-muted-foreground" data-testid="sub-rule" data-mode={c.rule.mode}>{ruleText}{c.line.alreadyShort > 0 && <> · {f(l.alreadyShort, { n: c.line.alreadyShort })}</>}</p>
          {c.rule.mode !== "NEVER" && (!c.candidates.length ? <p className="text-sm text-muted-foreground">{l.noCandidates}</p> : (
            <>
              <fieldset className="space-y-1">
                <legend className="mb-1 text-sm font-medium">{l.replacement}</legend>
                <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
                  {c.candidates.map((x) => (
                    <li key={x.offerId}>
                      <label className="flex cursor-pointer flex-wrap items-center gap-2 p-2 text-sm hover:bg-muted/50">
                        <input type="radio" name="sub-cand" value={x.offerId} checked={v.offerId === x.offerId} onChange={() => setV({ ...v, offerId: x.offerId })} data-testid="sub-cand" />
                        <span className="min-w-0 flex-1 basis-40 break-words">{x.name} <span className="text-xs text-muted-foreground">· {x.packaging}{x.brand ? ` · ${x.brand}` : ""}</span></span>
                        {x.linked && <Badge variant="secondary">{l.linked}</Badge>}
                        {x.sameBrand && <Badge variant="outline">{l.sameBrand}</Badge>}
                        <span className="text-xs text-muted-foreground">{f(l.inStock, { n: x.available })}</span>
                        <span className="tabular-nums">{eur(x.unitNet, locale)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1"><Label htmlFor="sub-short">{l.shortQty}</Label><Input id="sub-short" type="number" min={1} max={c.line.qty + c.line.alreadyShort} value={v.shortQty} onChange={(e) => setV({ ...v, shortQty: Math.max(1, Math.round(Number(e.target.value) || 1)) })} data-testid="sub-short" /></div>
                <div className="space-y-1"><Label htmlFor="sub-qty">{l.qty}</Label><Input id="sub-qty" type="number" min={1} value={v.qty} onChange={(e) => setV({ ...v, qty: Math.max(1, Math.round(Number(e.target.value) || 1)) })} data-testid="sub-qty" /></div>
                <div className="space-y-1"><Label htmlFor="sub-note">{l.note}</Label><Input id="sub-note" maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
              </div>
              {c.allowPriceMatch && <Check2 id="sub-match" checked={v.priceMatch} onChange={(x) => setV({ ...v, priceMatch: x })} label={l.priceMatch} testid="sub-match" />}
              {preview && <p className="text-sm" data-testid="sub-preview">{f(l.preview, { now: eur(preview.now, locale), was: eur(preview.was, locale), diff: pct(preview.diff, locale) })}</p>}
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={send} disabled={pending || !v.offerId} data-testid="sub-send"><Spin on={pending} icon={Send} /> {l.send}</Button>
                <Msg error={error} done={autoMsg ?? done} />
              </div>
            </>
          ))}
        </>
      )}
      {!c && <Msg error={error} done={autoMsg ?? done} />}
    </div>
  );
}

export function WithdrawButton({ l, id }: { l: L; id: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button size="sm" variant="outline" onClick={() => run(() => withdrawSubstitutionAction({ id }))} disabled={pending} data-testid="sub-withdraw"><Spin on={pending} icon={Undo2} /> {l.withdraw}</Button>
      <Msg error={error} />
    </span>
  );
}

type Opt = { id: string; name: string; packaging: string; sku: string };

/** Supplier: which of its products replace which. */
export function LinksEditor({ l }: { l: L }) {
  const { pending, error, done, run } = useRun();
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<Opt[]>([]);
  const [offerId, setOfferId] = useState("");
  const [links, setLinks] = useState<Opt[] | null>(null);
  const [add, setAdd] = useState("");
  const [, start] = useTransition();
  useEffect(() => {
    const t = setTimeout(() => start(async () => { const r = await ownOffersAction({ q }); if (r.ok) setOpts(r.data as Opt[]); }), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    setLinks(null);
    if (!offerId) return;
    start(async () => {
      const r = await substituteLinksAction({ offerId });
      if (r.ok) setLinks((r.data as { offerId: string; name: string; packaging: string; sku: string }[]).map((x) => ({ id: x.offerId, name: x.name, packaging: x.packaging, sku: x.sku })));
    });
  }, [offerId]);
  const name = (o: Opt) => `${o.name} · ${o.packaging} (${o.sku})`;
  const move = (i: number, d: -1 | 1) => setLinks((ls) => { if (!ls) return ls; const n = [...ls]; const j = i + d; if (j < 0 || j >= n.length) return ls; [n[i], n[j]] = [n[j], n[i]]; return n; });
  return (
    <div className="space-y-4" data-testid="sub-links">
      <div className="grid min-w-0 gap-2 sm:grid-cols-2 [&>*]:min-w-0 [&_select]:w-full">
        <Input placeholder={l.searchOwn} value={q} onChange={(e) => setQ(e.target.value)} aria-label={l.searchOwn} />
        <Select value={offerId} onChange={(e) => setOfferId(e.target.value)} aria-label={l.chooseProduct} data-testid="sub-links-offer">
          <option value="">{l.chooseProduct}</option>
          {opts.map((o) => <option key={o.id} value={o.id}>{name(o)}</option>)}
        </Select>
      </div>
      {offerId && links && (
        <>
          {!links.length ? <p className="text-sm text-muted-foreground">{l.noLinks}</p> : (
            <ol className="divide-y rounded-md border">
              {links.map((x, i) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2 p-2 text-sm" data-testid="sub-link">
                  <span className="w-5 text-xs text-muted-foreground">{i + 1}.</span>
                  <span className="min-w-0 flex-1 basis-48 break-words">{name(x)}</span>
                  <Button size="sm" variant="ghost" onClick={() => move(i, -1)} aria-label={l.up} disabled={i === 0}><ArrowUp className="size-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => move(i, 1)} aria-label={l.up} disabled={i === links.length - 1}><ArrowDown className="size-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setLinks(links.filter((y) => y.id !== x.id))} aria-label={l.remove}><Trash2 className="size-4" /></Button>
                </li>
              ))}
            </ol>
          )}
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] [&>*]:min-w-0 [&_select]:w-full">
            <Select value={add} onChange={(e) => setAdd(e.target.value)} aria-label={l.addReplacement} data-testid="sub-links-add-pick">
              <option value="">{l.addReplacement}…</option>
              {opts.filter((o) => o.id !== offerId && !links.some((y) => y.id === o.id)).map((o) => <option key={o.id} value={o.id}>{name(o)}</option>)}
            </Select>
            <Button variant="outline" disabled={!add || links.length >= 10} onClick={() => { const o = opts.find((x) => x.id === add); if (o) setLinks([...links, o]); setAdd(""); }} data-testid="sub-links-add"><Plus className="size-4" /> {l.add}</Button>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => run(() => setSubstituteLinksAction({ offerId, substituteOfferIds: links.map((x) => x.id) }), undefined, l.saved)} disabled={pending} data-testid="sub-links-save"><Spin on={pending} icon={Save} /> {l.save}</Button>
            <Msg error={error} done={done} />
          </div>
        </>
      )}
    </div>
  );
}

// ── FIRINGI (English) ───────────────────────────────────────────────────────

export function AdminSettingsForm({ s }: { s: SubstitutionSettings }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(s);
  return (
    <div className="space-y-4" data-testid="sub-admin-settings">
      <div className="grid gap-3 sm:grid-cols-2">
        <Check2 id="a-enabled" checked={v.enabled} onChange={(x) => setV({ ...v, enabled: x })} label="Substitutions on — suppliers can offer replacements for short products" testid="sub-admin-enabled" />
        <Check2 id="a-auto" checked={v.allowAuto} onChange={(x) => setV({ ...v, allowAuto: x })} label="Customers may let replacements be accepted automatically" />
        <Check2 id="a-match" checked={v.allowPriceMatch} onChange={(x) => setV({ ...v, allowPriceMatch: x })} label="Suppliers may offer “same price” (they pay the difference)" />
        <Check2 id="a-timeout" checked={v.defaultAcceptOnTimeout} onChange={(x) => setV({ ...v, defaultAcceptOnTimeout: x })} label="Default: unanswered proposals are accepted" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label htmlFor="a-min">Customer&apos;s time to answer (minutes)</Label><Input id="a-min" type="number" min={5} max={1440} value={v.responseMinutes} onChange={(e) => setV({ ...v, responseMinutes: Math.round(Number(e.target.value) || 0) })} /></div>
        <div className="space-y-1">
          <Label htmlFor="a-mode">Default rule (customers who haven&apos;t chosen)</Label>
          <Select id="a-mode" value={v.defaultMode} onChange={(e) => setV({ ...v, defaultMode: e.target.value as SubstitutionModeT })}>
            <option value="ASK">Ask each time</option><option value="AUTO">Automatic within the limit</option><option value="NEVER">No replacements</option>
          </Select>
        </div>
        <div className="space-y-1"><Label htmlFor="a-pct">Default automatic limit (% more)</Label><Input id="a-pct" type="number" min={0} max={100} value={v.defaultMaxPricePct} onChange={(e) => setV({ ...v, defaultMaxPricePct: Math.round(Number(e.target.value) || 0) })} /></div>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={() => run(() => saveSubstitutionSettingsAction(v), undefined, "Saved.")} disabled={pending} data-testid="sub-admin-save"><Spin on={pending} icon={Save} /> Save</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}
