"use client";
/** EU trade reporting (Phase 57) — FIRINGI's interactive parts (English). */
import { useState } from "react";
import { Check, CheckCheck, FileCheck2, Plus, RefreshCw, RotateCcw, Save, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  fileTradeReturnAction, openTradeReturnAction, readyTradeReturnAction, rebuildTradeReturnAction, recheckVatAction, refreshTradeAction, reopenTradeReturnAction,
  reviewCustomsAction, saveTradeSettingsAction, setCategoryCnAction, setProductCustomsAction,
} from "@/server/actions/trade";
import type { TradeCountry, TradeSettings } from "@/lib/trade";

const n = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

export function RefreshButton() {
  const { pending, error, done, run } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => refreshTradeAction({}), undefined, "Returns rebuilt from the documents.")} data-testid="trade-refresh"><Spin on={pending} icon={RefreshCw} /> Rebuild open returns</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

export function OpenPeriodForm({ entities }: { entities: { id: string; label: string }[] }) {
  const { pending, error, run, router } = useRun();
  const [v, setV] = useState({ legalEntityId: entities[0]?.id ?? "", kind: "ECSL", period: "" });
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => openTradeReturnAction({ ...v, kind: v.kind as "ECSL" }), (d) => router.push(`/admin/invoices/eu-trade/returns/${(d as { id: string }).id}`)); }} data-testid="trade-open">
      <div className="grid gap-1"><Label htmlFor="tp-le">Entity</Label><Select id="tp-le" value={v.legalEntityId} onChange={(e) => setV({ ...v, legalEntityId: e.target.value })}>{entities.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></div>
      <div className="grid gap-1"><Label htmlFor="tp-kind">Return</Label><Select id="tp-kind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option value="ECSL">EC Sales List</option><option value="ARRIVALS">Intrastat arrivals</option><option value="DISPATCHES">Intrastat dispatches</option></Select></div>
      <div className="grid gap-1"><Label htmlFor="tp-period">Period</Label><Input id="tp-period" className="w-32" placeholder="2026-10 or 2026-Q3" value={v.period} onChange={(e) => setV({ ...v, period: e.target.value.trim() })} required /></div>
      <Button size="sm" type="submit" disabled={pending}><Spin on={pending} icon={Plus} /> Open</Button>
      <Msg error={error} />
    </form>
  );
}

export function ReturnActions({ id, status, problems, canReopen }: { id: string; status: "OPEN" | "READY" | "FILED"; problems: number; canReopen: boolean }) {
  const { pending, error, done, run } = useRun();
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-3" data-testid="trade-actions">
      {status !== "FILED" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => rebuildTradeReturnAction({ id }), undefined, "Rebuilt.")} data-testid="trade-rebuild"><Spin on={pending} icon={RefreshCw} /> Rebuild from documents</Button>
          {status === "OPEN" && <Button size="sm" variant="outline" disabled={pending || problems > 0} title={problems ? "Fix the lines with missing data first" : undefined} onClick={() => run(() => readyTradeReturnAction({ id }), undefined, "Marked ready to file.")} data-testid="trade-ready"><Spin on={pending} icon={CheckCheck} /> Mark ready</Button>}
        </div>
      )}
      {status !== "FILED" && (
        <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); run(() => fileTradeReturnAction({ id, reference: ref, note: note || null }), () => setRef(""), "Recorded as filed."); }}>
          <div className="grid gap-1"><Label htmlFor="tf-ref">Submission reference</Label><Input id="tf-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Receipt number from the portal" required data-testid="trade-ref" /></div>
          <div className="grid gap-1"><Label htmlFor="tf-note">Note (optional)</Label><Input id="tf-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <Button size="sm" type="submit" disabled={pending} data-testid="trade-file"><Spin on={pending} icon={FileCheck2} /> Mark filed</Button>
        </form>
      )}
      {status !== "OPEN" && canReopen && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => reopenTradeReturnAction({ id, reason }), () => setReason(""), "Reopened."); }}>
          <div className="grid min-w-0 flex-1 basis-56 gap-1"><Label htmlFor="tf-reason">Reopen — reason</Label><Input id="tf-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={status === "FILED" ? "e.g. filed the wrong file; refiled as …" : "e.g. a late document"} required /></div>
          <Button size="sm" variant="outline" type="submit" disabled={pending} data-testid="trade-reopen"><Spin on={pending} icon={RotateCcw} /> Reopen</Button>
        </form>
      )}
      <Msg error={error} done={done} />
    </div>
  );
}

export function RecheckButton({ companyId }: { companyId: string }) {
  const { pending, error, done, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => recheckVatAction({ companyId }), (d) => void d, "Checked.")} data-testid={`vies-recheck-${companyId}`}><Spin on={pending} icon={ShieldCheck} /> Check at VIES</Button>
      <Msg error={error} done={done} />
    </span>
  );
}

export function CategoryCnRow({ id, cn, suppUnit }: { id: string; cn: string | null; suppUnit: string | null }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ cn: cn ?? "", unit: suppUnit ?? "" });
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setCategoryCnAction({ categoryId: id, cnCode: v.cn || null, suppUnit: v.unit || null }), undefined, "Saved."); }}>
      <Input aria-label="Default CN8 code" className="w-32 font-mono" placeholder="CN8" value={v.cn} onChange={(e) => setV({ ...v, cn: e.target.value })} data-testid={`cat-cn-${id}`} />
      <Input aria-label="Supplementary unit" className="w-20" placeholder="unit" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} />
      <Button size="sm" variant="ghost" type="submit" disabled={pending} aria-label="Save"><Spin on={pending} icon={Save} /></Button>
      <Msg error={error} done={done} />
    </form>
  );
}

type Pack = { id: string; sku: string; name: string; netKg: string | null; supp: string | null };
export function ProductCustomsForm({ id, cn, origin, suppUnit, packs }: { id: string; cn: string | null; origin: string | null; suppUnit: string | null; packs: Pack[] }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ cn: cn ?? "", origin: origin ?? "", unit: suppUnit ?? "" });
  const [ps, setPs] = useState(packs.map((p) => ({ id: p.id, label: `${p.sku} · ${p.name}`, kg: p.netKg ?? "", supp: p.supp ?? "" })));
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => setProductCustomsAction({ productId: id, cnCode: v.cn || null, originCountryCode: v.origin || null, suppUnit: v.unit || null, packs: ps.map((p) => ({ id: p.id, netWeightKg: n(p.kg), suppUnits: n(p.supp) })) }), undefined, "Saved and marked checked."); }} data-testid={`customs-${id}`}>
      <div className="flex flex-wrap gap-2">
        <div className="grid gap-1"><Label>CN8</Label><Input className="w-32 font-mono" value={v.cn} onChange={(e) => setV({ ...v, cn: e.target.value })} placeholder="2202 10 00" /></div>
        <div className="grid gap-1"><Label>Origin</Label><Input className="w-16 uppercase" maxLength={2} value={v.origin} onChange={(e) => setV({ ...v, origin: e.target.value.toUpperCase() })} placeholder="PT" /></div>
        <div className="grid gap-1"><Label>Suppl. unit</Label><Input className="w-20" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} placeholder="l" /></div>
      </div>
      {ps.map((p, i) => (
        <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 basis-48 break-words text-muted-foreground">{p.label}</span>
          <Input aria-label="Net mass kg per pack" className="w-28" placeholder="net kg" value={p.kg} onChange={(e) => setPs(ps.map((x, j) => (j === i ? { ...x, kg: e.target.value } : x)))} />
          <Input aria-label="Supplementary units per pack" className="w-28" placeholder="suppl. units" value={p.supp} onChange={(e) => setPs(ps.map((x, j) => (j === i ? { ...x, supp: e.target.value } : x)))} />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2"><Button size="sm" type="submit" disabled={pending}><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function ProposalReview({ p }: { p: { id: string; cn: string | null; netKg: string | null; supp: string | null; origin: string | null } }) {
  const { pending, error, run } = useRun();
  const [v, setV] = useState({ cn: p.cn ?? "", kg: p.netKg ?? "", supp: p.supp ?? "", origin: p.origin ?? "", note: "" });
  return (
    <div className="space-y-2" data-testid={`proposal-${p.id}`}>
      <div className="flex flex-wrap gap-2">
        <Input aria-label="CN8" className="w-32 font-mono" value={v.cn} onChange={(e) => setV({ ...v, cn: e.target.value })} placeholder="CN8" />
        <Input aria-label="Net kg" className="w-24" value={v.kg} onChange={(e) => setV({ ...v, kg: e.target.value })} placeholder="net kg" />
        <Input aria-label="Supplementary units" className="w-24" value={v.supp} onChange={(e) => setV({ ...v, supp: e.target.value })} placeholder="suppl." />
        <Input aria-label="Origin" className="w-16 uppercase" maxLength={2} value={v.origin} onChange={(e) => setV({ ...v, origin: e.target.value.toUpperCase() })} placeholder="PT" />
        <Input aria-label="Note to the supplier" className="min-w-0 flex-1 basis-40" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Note to the supplier (needed to reject)" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending} onClick={() => run(() => reviewCustomsAction({ id: p.id, accept: true, cnCode: v.cn || null, netWeightKg: n(v.kg), suppUnits: n(v.supp), originCountryCode: v.origin || null, note: v.note || null }))} data-testid={`proposal-accept-${p.id}`}><Spin on={pending} icon={Check} /> Accept</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reviewCustomsAction({ id: p.id, accept: false, note: v.note }))} data-testid={`proposal-reject-${p.id}`}><Spin on={pending} icon={X} /> Reject</Button>
        <Msg error={error} />
      </div>
    </div>
  );
}

// ── settings ──

const Toggle = ({ label, hint, checked, onChange, id }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; id: string }) => (
  <label className="flex items-start gap-2 text-sm" htmlFor={id}>
    <input id={id} type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={id} />
    <span><span className="font-medium">{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
  </label>
);

export function TradeSettingsForm({ initial, countries }: { initial: TradeSettings; countries: { code: string; name: string; hasEntity: boolean }[] }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const [days, setDays] = useState(initial.reminders.days.join(", "));
  const set = <K extends keyof TradeSettings>(k: K, v: TradeSettings[K]) => setS({ ...s, [k]: v });
  const setC = (code: string, v: Partial<TradeCountry>) => setS({ ...s, countries: { ...s.countries, [code]: { ...(s.countries[code] ?? initial.countries[code]), ...v } as TradeCountry } });
  const shown = countries.filter((c) => c.hasEntity || s.countries[c.code]);
  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); run(() => saveTradeSettingsAction({ ...s, reminders: { ...s.reminders, days: days.split(/[\s,;]+/).filter(Boolean).map(Number) } }), undefined, "Saved."); }} data-testid="trade-settings">
      <section className="grid gap-3 sm:grid-cols-2">
        <Toggle id="ts-enabled" label="EU trade reporting on" checked={s.enabled} onChange={(v) => set("enabled", v)} />
        <Toggle id="ts-ecsl" label="EC Sales List" hint="FIRINGI's exempt intra-EU sales and reverse-charge services" checked={s.returns.ecsl} onChange={(v) => set("returns", { ...s.returns, ecsl: v })} />
        <Toggle id="ts-arrivals" label="Intrastat arrivals" hint="Goods bought from suppliers in other EU countries" checked={s.returns.arrivals} onChange={(v) => set("returns", { ...s.returns, arrivals: v })} />
        <Toggle id="ts-dispatches" label="Intrastat dispatches" hint="Goods sold into other EU countries" checked={s.returns.dispatches} onChange={(v) => set("returns", { ...s.returns, dispatches: v })} />
        <Toggle id="ts-supplier" label="Suppliers' own reports" hint="Suppliers download what FIRINGI bought from them across a border" checked={s.returns.supplierReports} onChange={(v) => set("returns", { ...s.returns, supplierReports: v })} />
        <Toggle id="ts-cross" label="Sell into countries without a FIRINGI entity" hint="The main entity invoices as an exempt intra-EU supply (VIES-checked) or with its own VAT" checked={s.crossBorderSales} onChange={(v) => set("crossBorderSales", v)} />
        <Toggle id="ts-proposals" label="Suppliers can give customs codes" hint="CN8, net mass, supplementary units and origin per product — FIRINGI checks" checked={s.codes.supplierProposals} onChange={(v) => set("codes", { ...s.codes, supplierProposals: v })} />
        <Toggle id="ts-catdefault" label="Use the category's CN8 code when a product has none" hint="Flagged on the line so it can be checked" checked={s.codes.categoryDefault} onChange={(v) => set("codes", { ...s.codes, categoryDefault: v })} />
        <Toggle id="ts-corrections" label="Corrections" hint="Credits after a period is filed go into the next return, marked with the period they correct" checked={s.corrections} onChange={(v) => set("corrections", v)} />
        <Toggle id="ts-threshold" label="Threshold watch" hint="Warn finance when a flow gets near the country's Intrastat threshold" checked={s.thresholds.watch} onChange={(v) => set("thresholds", { ...s.thresholds, watch: v })} />
        <Toggle id="ts-reminders" label="Deadline reminders" checked={s.reminders.enabled} onChange={(v) => set("reminders", { ...s.reminders, enabled: v })} />
        <Toggle id="ts-recheck" label="Check the buyer's VAT number at VIES before invoicing without VAT" hint="The answer is kept as proof with the invoice" checked={s.vies.recheck} onChange={(v) => set("vies", { ...s.vies, recheck: v })} />
      </section>
      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="grid gap-1"><Label htmlFor="ts-age">Reuse a VIES check for (days)</Label><Input id="ts-age" type="number" min={0} max={365} value={s.vies.maxAgeDays} onChange={(e) => set("vies", { ...s.vies, maxAgeDays: Number(e.target.value) })} /></div>
        <div className="grid gap-1"><Label htmlFor="ts-onerr">VIES not answering</Label><Select id="ts-onerr" value={s.vies.onError} onChange={(e) => set("vies", { ...s.vies, onError: e.target.value as "LOCAL_VAT" })}><option value="LOCAL_VAT">Charge local VAT</option><option value="LAST_VALID">Use the last valid check</option></Select></div>
        <div className="grid gap-1"><Label htmlFor="ts-warn">Warn at % of threshold</Label><Input id="ts-warn" type="number" min={1} max={100} value={s.thresholds.warnAtPct} onChange={(e) => set("thresholds", { ...s.thresholds, warnAtPct: Number(e.target.value) })} /></div>
        <div className="grid gap-1"><Label htmlFor="ts-days">Remind days before</Label><Input id="ts-days" value={days} onChange={(e) => setDays(e.target.value)} placeholder="7, 3, 1" /></div>
        <div className="grid gap-1"><Label htmlFor="ts-nature">Nature of transaction</Label><Input id="ts-nature" value={s.defaults.natureCode} onChange={(e) => set("defaults", { ...s.defaults, natureCode: e.target.value })} /></div>
        <div className="grid gap-1"><Label htmlFor="ts-mode">Mode of transport</Label><Input id="ts-mode" value={s.defaults.transportMode} onChange={(e) => set("defaults", { ...s.defaults, transportMode: e.target.value })} /></div>
        <div className="grid gap-1"><Label htmlFor="ts-terms">Delivery terms</Label><Input id="ts-terms" value={s.defaults.deliveryTerms} onChange={(e) => set("defaults", { ...s.defaults, deliveryTerms: e.target.value.toUpperCase() })} /></div>
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">Countries</h3>
        <p className="text-xs text-muted-foreground">Thresholds and deadlines change most years — check them with each statistics office and tax authority every January. 0 = no threshold (the authority tells you when you must file).</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Country</th><th>File layout</th><th>EC Sales List</th><th>ESL due day</th><th>Intrastat due day</th><th>Arrivals threshold €</th><th>Must file arrivals</th><th>Dispatches threshold €</th><th>Must file dispatches</th></tr></thead>
            <tbody>
              {shown.map((c) => {
                const v = s.countries[c.code] ?? initial.countries[c.code];
                if (!v) return null;
                return (
                  <tr key={c.code} className="border-t" data-testid={`ts-country-${c.code}`}>
                    <td className="py-1.5 pr-2">{c.code} · {c.name}</td>
                    <td><Select aria-label="File layout" value={v.format} onChange={(e) => setC(c.code, { format: e.target.value as TradeCountry["format"] })}><option value="GENERIC">Generic</option><option value="PT">Portugal (AT / INE)</option><option value="ES">Spain (Modelo 349)</option><option value="FR">France (DEB / DES)</option><option value="DE">Germany (ZM / IDEV)</option></Select></td>
                    <td><Select aria-label="EC Sales List period" value={v.ecslPeriod} onChange={(e) => setC(c.code, { ecslPeriod: e.target.value as "MONTHLY" })}><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option></Select></td>
                    <td><Input aria-label="EC Sales List due day" type="number" min={1} max={28} className="w-16" value={v.ecslDueDay} onChange={(e) => setC(c.code, { ecslDueDay: Number(e.target.value) })} /></td>
                    <td><Input aria-label="Intrastat due day" type="number" min={1} max={28} className="w-16" value={v.intrastatDueDay} onChange={(e) => setC(c.code, { intrastatDueDay: Number(e.target.value) })} /></td>
                    <td><Input aria-label="Arrivals threshold" type="number" min={0} className="w-28" value={v.arrivalsThreshold} onChange={(e) => setC(c.code, { arrivalsThreshold: Number(e.target.value) })} /></td>
                    <td className="text-center"><input type="checkbox" aria-label="Must file arrivals" checked={v.arrivalsObliged} onChange={(e) => setC(c.code, { arrivalsObliged: e.target.checked })} data-testid={`ts-arr-obliged-${c.code}`} /></td>
                    <td><Input aria-label="Dispatches threshold" type="number" min={0} className="w-28" value={v.dispatchesThreshold} onChange={(e) => setC(c.code, { dispatchesThreshold: Number(e.target.value) })} /></td>
                    <td className="text-center"><input type="checkbox" aria-label="Must file dispatches" checked={v.dispatchesObliged} onChange={(e) => setC(c.code, { dispatchesObliged: e.target.checked })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-2"><Button type="submit" disabled={pending} data-testid="ts-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}
