"use client";
/** Sold by weight (Phase 41) — interactive parts (texts passed in as `l`; FIRINGI admin parts are in English). */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Save, ScanLine, Scale, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { acceptOverWeightAction, recordWeightsAction, saveCatchWeightSettingsAction, saveOfferCatchWeightAction, scanWeightLabelAction } from "@/server/actions/catchweight";
import type { CatchWeightSettings } from "@/lib/catch-weight";

export type L = Record<string, string>;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const kgFmt = (n: number, locale: string) => new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n);
const num = (v: string) => { const x = Number(v.replace(",", ".")); return Number.isFinite(x) ? x : NaN; };

// ── supplier: product setup ─────────────────────────────────────────────────

export type OfferRow = { id: string; name: string; packaging: string; sku: string | null; mode: "PIECE" | "KG" | null; nominalKg: number | null; minKg: number | null; maxKg: number | null; maxOverPct: number | null; plu: string | null; unitPrice: number | null; perKg: number | null };

/** One product's sold-by-weight settings (Products › Sold by weight). */
export function OfferCwForm({ l, locale, o, limit }: { l: L; locale: string; o: OfferRow; limit: number }) {
  const { pending, error, done, run } = useRun();
  const [mode, setMode] = useState<"" | "PIECE" | "KG">(o.mode ?? "");
  const [v, setV] = useState({ nominal: o.nominalKg?.toString() ?? (o.mode === "KG" ? "1" : ""), min: o.minKg?.toString() ?? "", max: o.maxKg?.toString() ?? "", pct: o.maxOverPct?.toString() ?? "", plu: o.plu ?? "" });
  const opt = (s: string) => (s.trim() ? num(s) : null);
  const perKg = o.unitPrice && num(v.nominal) > 0 ? o.unitPrice / num(v.nominal) : null;
  const save = () =>
    run(() => saveOfferCatchWeightAction({ offerId: o.id, mode: mode || null, nominalKg: mode ? opt(v.nominal) : null, minKg: mode === "PIECE" ? opt(v.min) : null, maxKg: mode === "PIECE" ? opt(v.max) : null, maxOverPct: mode ? opt(v.pct) : null, plu: mode ? v.plu.trim() || null : null }), undefined, l.saved);
  return (
    <div className="space-y-3" data-testid="cw-offer" data-offer={o.id}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`m-${o.id}`}>{l.sellBy}</Label>
          <Select id={`m-${o.id}`} value={mode} onChange={(e) => { const m = e.target.value as "" | "PIECE" | "KG"; setMode(m); if (m === "KG" && !v.nominal) setV({ ...v, nominal: "1" }); }} data-testid="cw-mode">
            <option value="">{l.modeNone}</option><option value="PIECE">{l.modePiece}</option><option value="KG">{l.modeKg}</option>
          </Select>
        </div>
        {mode && (
          <div className="space-y-1">
            <Label htmlFor={`n-${o.id}`}>{mode === "PIECE" ? l.avgWeight : l.unitWeight}</Label>
            <Input id={`n-${o.id}`} inputMode="decimal" value={v.nominal} onChange={(e) => setV({ ...v, nominal: e.target.value })} data-testid="cw-nominal" />
          </div>
        )}
        {mode && (
          <div className="space-y-1">
            <Label htmlFor={`p-${o.id}`}>{f(l.yourLimit, { pct: limit })}</Label>
            <Input id={`p-${o.id}`} inputMode="decimal" placeholder={String(limit)} value={v.pct} onChange={(e) => setV({ ...v, pct: e.target.value })} data-testid="cw-pct" />
          </div>
        )}
        {mode === "PIECE" && (
          <>
            <div className="space-y-1"><Label htmlFor={`a-${o.id}`}>{l.minKg}</Label><Input id={`a-${o.id}`} inputMode="decimal" value={v.min} onChange={(e) => setV({ ...v, min: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor={`b-${o.id}`}>{l.maxKg}</Label><Input id={`b-${o.id}`} inputMode="decimal" value={v.max} onChange={(e) => setV({ ...v, max: e.target.value })} /></div>
          </>
        )}
        {mode && <div className="space-y-1"><Label htmlFor={`u-${o.id}`}>{l.plu}</Label><Input id={`u-${o.id}`} inputMode="numeric" value={v.plu} onChange={(e) => setV({ ...v, plu: e.target.value })} data-testid="cw-plu" /></div>}
      </div>
      {mode && perKg != null && <p className="text-sm text-muted-foreground" data-testid="cw-perkg">{f(l.perKgHint, { price: new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(perKg) })}</p>}
      {o.mode && mode && o.nominalKg && num(v.nominal) !== o.nominalKg && <p className="text-xs text-muted-foreground">{l.keepPerKgNote}</p>}
      <div className="flex flex-wrap items-center gap-3"><Button size="sm" onClick={save} disabled={pending} data-testid="cw-save"><Spin on={pending} icon={Save} /> {l.save}</Button><Msg error={error} done={done} /></div>
    </div>
  );
}

// ── supplier / FIRINGI: weighing an order line ──────────────────────────────

/** Weights of one sold-by-weight line: one field per piece (or the total for kilos), plus a scale-label scanner. */
export function WeighForm({ l, locale, lineId, mode, units, pieces, source = "SUPPLIER" }: { l: L; locale: string; lineId: string; mode: "PIECE" | "KG"; units: number; pieces: number[]; source?: "PICK" | "SUPPLIER" }) {
  const { pending, error, done, run } = useRun();
  const start = pieces.length ? pieces.map(String) : Array.from({ length: mode === "PIECE" ? Math.min(Math.max(units, 1), 50) : 1 }, () => "");
  const [rows, setRows] = useState<string[]>(start);
  const [code, setCode] = useState("");
  const [scan, setScan] = useState<string | null>(null);
  const [scanning, startScan] = useTransition();
  const router = useRouter();
  const scanRef = useRef<HTMLInputElement>(null);
  const vals = rows.map(num).filter((x) => x > 0);
  const total = vals.reduce((a, x) => a + x, 0);
  const save = () => run(() => recordWeightsAction({ orderLineId: lineId, pieces: vals, source }), undefined, l.weighed);
  // a scan only refreshes the page when a piece was added (a refused label just shows why)
  const doScan = () => {
    const c = code.trim();
    if (!c) return;
    startScan(async () => {
      const res = await scanWeightLabelAction({ orderLineId: lineId, code: c });
      if (!res.ok) { setScan(res.error ?? "Error"); return; }
      const r = res.data as { outcome: string; kg?: number; totalKg?: number; pieces?: number };
      setScan(r.outcome === "OK" ? f(l.scanOk, { kg: kgFmt(r.kg ?? 0, locale), total: kgFmt(r.totalKg ?? 0, locale), pieces: r.pieces ?? 0 }) : l[`scan.${r.outcome}`] ?? r.outcome);
      setCode(""); scanRef.current?.focus();
      if (r.outcome === "OK") router.refresh();
    });
  };
  return (
    <div className="space-y-2" data-testid="weigh-form" data-line={lineId}>
      <div className="flex flex-wrap gap-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1">
            <Input aria-label={mode === "PIECE" ? f(l.pieceN, { n: i + 1 }) : l.totalKg} inputMode="decimal" className="h-9 w-24" placeholder="kg" value={r} onChange={(e) => setRows(rows.map((x, j) => (j === i ? e.target.value : x)))} data-testid="piece-kg" />
            {rows.length > 1 && <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={l.remove} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>}
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={() => setRows([...rows, ""])}><Plus className="size-4" /> {mode === "PIECE" ? l.addPiece : l.addWeight}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={save} disabled={pending || !vals.length || vals.length !== rows.filter((x) => x.trim()).length} data-testid="weigh-save"><Spin on={pending} icon={Scale} /> {l.saveWeights}</Button>
        <span className="text-sm tabular-nums" data-testid="weigh-total">{f(l.totalIs, { kg: kgFmt(total, locale) })}</span>
      </div>
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); doScan(); }}>
        <Input ref={scanRef} aria-label={l.scanLabel} placeholder={l.scanLabel} className="h-9 w-64 max-w-full" value={code} onChange={(e) => setCode(e.target.value)} data-testid="weigh-scan" />
        <Button type="submit" size="sm" variant="outline" disabled={!code.trim()} aria-busy={scanning}><ScanLine className="size-4" /> {l.scanBtn}</Button>
      </form>
      {scan && <p className="text-sm" role="status" data-testid="scan-result">{scan}</p>}
      <Msg error={error} done={done} />
    </div>
  );
}

// ── buyer: accept the extra weight ──────────────────────────────────────────

export function AcceptOverButton({ l, orderId }: { l: L; orderId: string }) {
  const { pending, error, run } = useRun();
  return (
    <div className="space-y-1">
      <Button size="sm" onClick={() => run(() => acceptOverWeightAction({ orderId }))} disabled={pending} data-testid="accept-over"><Spin on={pending} icon={Check} /> {l.acceptOver}</Button>
      <Msg error={error} />
    </div>
  );
}

// ── driver: weights at the stop ─────────────────────────────────────────────

export type StopWeightLine = { id: string; product: string; units: number; mode: "PIECE" | "KG"; estimatedKg: number; actualKg: number | null; maxKg: number; over: boolean; accepted: boolean };

/** In the proof-of-delivery form: weigh again if the customer asks, and tick when they accept weight above the limit. */
export function StopWeights({ l, locale, lines, correction, value, onChange, accept, onAccept }: {
  l: L; locale: string; lines: StopWeightLine[]; correction: boolean; value: Record<string, string>; onChange: (v: Record<string, string>) => void; accept: boolean; onAccept: (v: boolean) => void;
}) {
  if (!lines.length) return null;
  const over = lines.some((x) => x.over && !x.accepted) || lines.some((x) => num(value[x.id] ?? "") > x.maxKg);
  return (
    <div className="space-y-2 rounded-xl border p-3" data-testid="stop-weights">
      <p className="flex items-center gap-2 text-sm font-medium"><Scale className="size-4" /> {l.stopTitle}</p>
      <ul className="space-y-2">
        {lines.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1 basis-40 break-words">{x.product} <span className="text-xs text-muted-foreground">· {x.units} · {x.actualKg != null ? f(l.weighedKg, { kg: kgFmt(x.actualKg, locale) }) : f(l.estimatedKg, { kg: kgFmt(x.estimatedKg, locale) })}</span></span>
            {correction && <Input aria-label={f(l.newWeightFor, { product: x.product })} inputMode="decimal" className="h-9 w-28" placeholder="kg" value={value[x.id] ?? ""} onChange={(e) => onChange({ ...value, [x.id]: e.target.value })} data-testid="stop-weight" />}
          </li>
        ))}
      </ul>
      {over && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={accept} onChange={(e) => onAccept(e.target.checked)} data-testid="stop-accept" /> {l.customerAccepts}</label>}
    </div>
  );
}

// ── FIRINGI settings (English) ──────────────────────────────────────────────

export function SettingsForm({ initial, countries }: { initial: CatchWeightSettings; countries: { code: string; name: string }[] }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState<CatchWeightSettings>(initial);
  const n = (v: string) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  return (
    <div className="space-y-6" data-testid="cw-settings">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> Sold by weight on</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.driverCorrection} onChange={(e) => setS({ ...s, driverCorrection: e.target.checked })} /> Drivers can change weights at the stop</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.requireWeighing} onChange={(e) => setS({ ...s, requireWeighing: e.target.checked })} data-testid="cw-require" /> Weigh before dispatch (no dispatch with unweighed lines)</label>
        <div className="space-y-1"><Label htmlFor="cw-buffer">Pay-before-shipping buffer on weighed lines (%)</Label><Input id="cw-buffer" type="number" min={0} max={50} value={s.prepayBufferPct} onChange={(e) => setS({ ...s, prepayBufferPct: n(e.target.value) })} data-testid="cw-buffer" /></div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Over-weight limit — the customer pays at most this much above the ordered weight, unless they accept more</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1"><Label htmlFor="cw-def">Everywhere (%)</Label><Input id="cw-def" type="number" min={0} max={50} value={s.maxOverPct.default} onChange={(e) => setS({ ...s, maxOverPct: { ...s.maxOverPct, default: n(e.target.value) } })} data-testid="cw-default" /></div>
          {countries.map((c) => (
            <div key={c.code} className="space-y-1">
              <Label htmlFor={`cw-${c.code}`}>{c.name} (%)</Label>
              <Input id={`cw-${c.code}`} type="number" min={0} max={50} placeholder={String(s.maxOverPct.default)} value={s.maxOverPct[c.code] ?? ""}
                onChange={(e) => { const m = { ...s.maxOverPct }; if (e.target.value === "") delete m[c.code]; else m[c.code] = n(e.target.value); setS({ ...s, maxOverPct: m }); }} />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Suppliers can set a tighter limit per product, never a looser one. Lighter than ordered: the customer always pays the real weight.</p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Scale labels (EAN-13 with the weight)</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1"><Label htmlFor="cw-pre">Prefixes</Label><Input id="cw-pre" value={s.ean13.prefixes.join(", ")} onChange={(e) => setS({ ...s, ean13: { ...s.ean13, prefixes: e.target.value.split(/[,\s]+/).filter(Boolean) } })} /></div>
          <div className="space-y-1"><Label htmlFor="cw-item">Item code digits</Label><Input id="cw-item" type="number" min={4} max={6} value={s.ean13.itemDigits} onChange={(e) => setS({ ...s, ean13: { ...s.ean13, itemDigits: n(e.target.value) } })} /></div>
          <div className="space-y-1"><Label htmlFor="cw-val">Weight digits</Label><Input id="cw-val" type="number" min={4} max={6} value={s.ean13.valueDigits} onChange={(e) => setS({ ...s, ean13: { ...s.ean13, valueDigits: n(e.target.value) } })} /></div>
          <div className="space-y-1"><Label htmlFor="cw-g">Grams per step</Label><Select id="cw-g" value={s.ean13.gramsPerUnit} onChange={(e) => setS({ ...s, ean13: { ...s.ean13, gramsPerUnit: n(e.target.value) } })}>{[1, 2, 5, 10].map((g) => <option key={g} value={g}>{g} g</option>)}</Select></div>
        </div>
        <p className="text-xs text-muted-foreground">GS1-128 / DataMatrix labels with AI 310n (net weight in kg) are read too.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => run(() => saveCatchWeightSettingsAction({ ...s, maxOverPct: { ...s.maxOverPct } }), undefined, "Saved")} disabled={pending} data-testid="cw-settings-save"><Spin on={pending} icon={Save} /> Save</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}
