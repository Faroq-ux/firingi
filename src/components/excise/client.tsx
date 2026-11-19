"use client";
/** Licensed & excise goods (Phase 43) — interactive parts (texts passed in as `l`; FIRINGI admin parts are in English). */
import { useState } from "react";
import { Check, FileUp, Plus, Save, ShieldCheck, ShieldX, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  addExciseRateAction, recordExciseDocAction, recordLicenceAction, reviewLicenceAction, saveExciseCategoryAction, saveExciseSettingsAction,
  saveLicenceTypeAction, saveOfferExciseAction, setShopCategoryExciseAction, uploadLicenceAction, withdrawLicenceAction,
} from "@/server/actions/excise";
import type { ExciseSettings } from "@/lib/excise";

export type L = Record<string, string>;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const s = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));
const codes = (t: string) => t.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);

// ── supplier ────────────────────────────────────────────────────────────────

export type ExciseOfferRow = {
  offerId: string; own: string | null; inherited: string | null; basis?: string | null; dutyMode: "PAID" | "ADDED"; exciseCountries: string[];
  measures: { abv?: number | null; volumeL?: number | null; exciseUnits?: number | null; netKg?: number | null; sugarGPerL?: number | null };
};
const FIELDS: Record<string, ("abv" | "volumeL" | "exciseUnits" | "netKg" | "sugarGPerL")[]> = {
  HL_PURE_ALCOHOL: ["volumeL", "abv"], HL_PER_ABV: ["volumeL", "abv"], HL_PRODUCT: ["volumeL", "abv"], ML: ["volumeL"], THOUSAND_UNITS: ["exciseUnits"], KG: ["netKg"], HL_SUGAR_BAND: ["volumeL", "sugarGPerL"],
};

export function OfferExciseForm({ l, row, categories, calculate }: { l: L; row: ExciseOfferRow; categories: { id: string; name: string; basis: string }[]; calculate: boolean }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({
    cat: row.own ?? "", abv: s(row.measures.abv), volumeL: s(row.measures.volumeL), exciseUnits: s(row.measures.exciseUnits), netKg: s(row.measures.netKg), sugarGPerL: s(row.measures.sugarGPerL),
    mode: row.dutyMode, countries: row.exciseCountries.join(" "),
  });
  const cid = v.cat || row.inherited;
  const basis = categories.find((c) => c.id === cid)?.basis ?? row.basis ?? "HL_PRODUCT";
  const inh = categories.find((c) => c.id === row.inherited)?.name ?? "—";
  const fields = FIELDS[basis] ?? [];
  return (
    <div className="space-y-2" data-testid="ex-offer-form" data-offer={row.offerId}>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor={`ec-${row.offerId}`}>{l.colCategory}</Label>
          <Select id={`ec-${row.offerId}`} value={v.cat} onChange={(e) => setV({ ...v, cat: e.target.value })} data-testid="ex-category">
            <option value="">{f(l.fromCategory, { cat: inh })}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        {fields.map((k) => (
          <div key={k} className="space-y-1">
            <Label htmlFor={`${k}-${row.offerId}`}>{l[k]}</Label>
            <Input id={`${k}-${row.offerId}`} inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} data-testid={`ex-${k}`} />
          </div>
        ))}
        <div className="space-y-1">
          <Label htmlFor={`mode-${row.offerId}`}>{l.dutyMode}</Label>
          <Select id={`mode-${row.offerId}`} value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as "PAID" | "ADDED" })} data-testid="ex-mode">
            <option value="PAID">{l["mode.PAID"]}</option>
            {(calculate || v.mode === "ADDED") && <option value="ADDED">{l["mode.ADDED"]}</option>}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`cty-${row.offerId}`}>{l.countries}</Label>
          <Input id={`cty-${row.offerId}`} placeholder="PT ES" value={v.countries} onChange={(e) => setV({ ...v, countries: e.target.value })} data-testid="ex-countries" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={pending} data-testid="ex-save"
          onClick={() => run(() => saveOfferExciseAction({ offerId: row.offerId, exciseCategoryId: v.cat || null, abv: v.abv, volumeL: v.volumeL, exciseUnits: v.exciseUnits, netKg: v.netKg, sugarGPerL: v.sugarGPerL, dutyMode: v.mode, exciseCountries: codes(v.countries) }), undefined, l.saved)}>
          <Spin on={pending} icon={Save} /> {l.save}
        </Button>
        <span className="text-xs text-muted-foreground">{l.countriesHint}</span>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

// ── customer licences ───────────────────────────────────────────────────────

export function LicenceUploadForm({ l, types }: { l: L; types: { id: string; name: string; needsNumber: boolean; hasExpiry: boolean }[] }) {
  const { pending, error, done, run } = useRun();
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const t = types.find((x) => x.id === typeId);
  const [key, setKey] = useState(0);
  return (
    <form key={key} className="space-y-3" data-testid="licence-form" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(() => uploadLicenceAction(fd), () => setKey(key + 1), l.sent); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="lic-type">{l.licenceType}</Label><Select id="lic-type" name="typeId" value={typeId} onChange={(e) => setTypeId(e.target.value)}>{types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></div>
        <div className="space-y-1"><Label htmlFor="lic-number">{l.number}</Label><Input id="lic-number" name="number" required={t?.needsNumber} maxLength={80} /></div>
        <div className="space-y-1"><Label htmlFor="lic-issuer">{l.issuer}</Label><Input id="lic-issuer" name="issuer" maxLength={120} /></div>
        <div className="space-y-1"><Label htmlFor="lic-issued">{l.issuedOn}</Label><Input id="lic-issued" name="issuedOn" type="date" /></div>
        {t?.hasExpiry !== false && <div className="space-y-1"><Label htmlFor="lic-expires">{l.expiresOn}</Label><Input id="lic-expires" name="expiresOn" type="date" required /></div>}
        <div className="space-y-1"><Label htmlFor="lic-file">{l.file}</Label><Input id="lic-file" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required /></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || !typeId} data-testid="licence-send"><Spin on={pending} icon={FileUp} /> {l.send}</Button>
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

export function WithdrawLicence({ l, id }: { l: L; id: string }) {
  const { pending, run } = useRun();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => withdrawLicenceAction({ id }))}><Spin on={pending} icon={Trash2} /> {l.withdraw}</Button>;
}

// ── order: accompanying document ────────────────────────────────────────────

export function ExciseDocForm({ l, orderId, type, docRef }: { l: L; orderId: string; type: string | null; docRef: string | null }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ type: type ?? "E_DA", ref: docRef ?? "" });
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="excise-doc-form">
      <div className="space-y-1"><Label htmlFor={`dt-${orderId}`}>{l.docType}</Label><Select id={`dt-${orderId}`} className="h-9" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>{["E_DA", "E_SAD", "SAAD", "DSA", "OTHER"].map((k) => <option key={k} value={k}>{l[`doc.${k}`]}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor={`dr-${orderId}`}>{l.docRef}</Label><Input id={`dr-${orderId}`} className="h-9 w-64 max-w-full font-mono" value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })} data-testid="excise-doc-ref" /></div>
      <Button size="sm" disabled={pending || !v.ref.trim()} onClick={() => run(() => recordExciseDocAction({ orderId, docType: v.type, docRef: v.ref }), undefined, l.saved)} data-testid="excise-doc-save"><Spin on={pending} icon={Save} /> {l.save}</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

// ── FIRINGI (English) ───────────────────────────────────────────────────────

export function ExciseSettingsForm({ initial }: { initial: ExciseSettings }) {
  const { pending, error, done, run } = useRun();
  const [x, setX] = useState<ExciseSettings>(initial);
  const [overrides, setOverrides] = useState(Object.entries(initial.licences.countries).map(([c, v]) => `${c}:${v.buyer === false ? "off" : v.enforcement ?? "on"}`).join(" "));
  const [days, setDays] = useState(initial.licences.reminderDays.join(" "));
  const box = (label: string, checked: boolean, on: (v: boolean) => void, testid?: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(e) => on(e.target.checked)} data-testid={testid} /> {label}</label>;
  const parseOverrides = () => Object.fromEntries(overrides.split(/[\s,;]+/).filter(Boolean).map((p) => {
    const [c, v] = p.split(":"); const code = (c ?? "").toUpperCase(); const val = (v ?? "").toUpperCase();
    return [code, val === "OFF" ? { buyer: false } : val === "WARN" || val === "BLOCK" ? { buyer: true, enforcement: val as "WARN" | "BLOCK" } : { buyer: true }];
  }).filter(([c]) => /^[A-Z]{2}$/.test(c as string)));
  return (
    <div className="space-y-6" data-testid="ex-settings">
      {box("Licensed & excise goods on", x.enabled, (v) => setX({ ...x, enabled: v }), "ex-enabled")}
      <div className="space-y-2"><p className="text-sm font-medium">Which goods</p>
        <div className="grid gap-2 sm:grid-cols-4">
          {box("Alcohol (beer, wine, spirits)", x.kinds.ALCOHOL, (v) => setX({ ...x, kinds: { ...x.kinds, ALCOHOL: v } }))}
          {box("Tobacco", x.kinds.TOBACCO, (v) => setX({ ...x, kinds: { ...x.kinds, TOBACCO: v } }))}
          {box("Vaping (e-liquids)", x.kinds.VAPING, (v) => setX({ ...x, kinds: { ...x.kinds, VAPING: v } }))}
          {box("Sugary drinks", x.kinds.SUGAR, (v) => setX({ ...x, kinds: { ...x.kinds, SUGAR: v } }))}
        </div>
      </div>
      <div className="space-y-2"><p className="text-sm font-medium">Licences</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {box("Customers need a licence for alcohol, tobacco and vaping", x.licences.buyer, (v) => setX({ ...x, licences: { ...x.licences, buyer: v } }), "ex-buyer")}
          {box("Suppliers need their excise authorisation (offers paused without it)", x.licences.supplier, (v) => setX({ ...x, licences: { ...x.licences, supplier: v } }), "ex-supplier")}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1"><Label htmlFor="ex-enf">Without a licence</Label>
            <Select id="ex-enf" value={x.licences.enforcement} onChange={(e) => setX({ ...x, licences: { ...x.licences, enforcement: e.target.value as "BLOCK" | "WARN" } })} data-testid="ex-enforcement">
              <option value="BLOCK">Block: hidden and refused at checkout</option><option value="WARN">Warn: visible, can order, customer told</option>
            </Select>
          </div>
          <div className="space-y-1"><Label htmlFor="ex-cty">Per country (e.g. ES:off FR:warn)</Label><Input id="ex-cty" value={overrides} onChange={(e) => setOverrides(e.target.value)} data-testid="ex-overrides" /></div>
          <div className="space-y-1"><Label htmlFor="ex-days">Reminders before expiry (days)</Label><Input id="ex-days" value={days} onChange={(e) => setDays(e.target.value)} /></div>
        </div>
      </div>
      <div className="space-y-2"><p className="text-sm font-medium">Duty</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {box("Show the excise in the price (cart, order, invoice)", x.duty.show, (v) => setX({ ...x, duty: { ...x.duty, show: v } }))}
          {box("FIRINGI calculates the duty and adds it as its own line (suppliers choose per product)", x.duty.calculate, (v) => setX({ ...x, duty: { ...x.duty, calculate: v } }), "ex-calculate")}
        </div>
      </div>
      <div className="space-y-2"><p className="text-sm font-medium">Restrictions</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {box("Country restrictions", x.restrictions.countries, (v) => setX({ ...x, restrictions: { ...x.restrictions, countries: v } }))}
          {box("Quantity caps per order", x.restrictions.qtyCaps, (v) => setX({ ...x, restrictions: { ...x.restrictions, qtyCaps: v } }))}
          {box("Driver checks the licence / ID at delivery", x.restrictions.driverCheck, (v) => setX({ ...x, restrictions: { ...x.restrictions, driverCheck: v } }), "ex-driver")}
        </div>
      </div>
      <div className="space-y-2"><p className="text-sm font-medium">Records</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {box("Monthly excise report (PDF / CSV)", x.records.report, (v) => setX({ ...x, records: { ...x.records, report: v } }))}
          {box("Licence register", x.records.register, (v) => setX({ ...x, records: { ...x.records, register: v } }))}
          {box("Excise in the accounting export (own account)", x.records.accounting, (v) => setX({ ...x, records: { ...x.records, accounting: v } }))}
          {box("Accompanying documents (e-DA / SAAD reference)", x.records.deliveryDocs, (v) => setX({ ...x, records: { ...x.records, deliveryDocs: v } }))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending} data-testid="ex-settings-save"
          onClick={() => run(() => saveExciseSettingsAction({ ...x, licences: { ...x.licences, countries: parseOverrides(), reminderDays: days.split(/[\s,;]+/).map(Number).filter((d) => Number.isInteger(d) && d > 0) } }), undefined, "Saved")}>
          <Spin on={pending} icon={Save} /> Save
        </Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function ExciseCategoryForm({ c }: { c: { id: string; maxPerOrder: number | null; blockedCountries: string[]; active: boolean } }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ max: c.maxPerOrder?.toString() ?? "", blocked: c.blockedCountries.join(" "), active: c.active });
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="ex-cat-form" data-cat={c.id}>
      <div className="space-y-1"><Label htmlFor={`max-${c.id}`}>Max per order</Label><Input id={`max-${c.id}`} className="h-9 w-24" inputMode="numeric" placeholder="no cap" value={v.max} onChange={(e) => setV({ ...v, max: e.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor={`bl-${c.id}`}>Not to countries</Label><Input id={`bl-${c.id}`} className="h-9 w-32" placeholder="FR NL" value={v.blocked} onChange={(e) => setV({ ...v, blocked: e.target.value })} /></div>
      <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Active</label>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => saveExciseCategoryAction({ id: c.id, maxPerOrder: v.max.trim() ? Math.round(Number(v.max)) : null, blockedCountries: codes(v.blocked), active: v.active }), undefined, "Saved")}><Spin on={pending} icon={Save} /> Save</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

export function RateForm({ categoryId, sugar, tobacco }: { categoryId: string; sugar: boolean; tobacco: boolean }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ country: "PT", rate: "", adv: "", bands: "25:1.13 50:6.89 80:9.10 *:22.76", from: new Date().toISOString().slice(0, 10), note: "" });
  const bands = () => v.bands.split(/\s+/).filter(Boolean).map((p) => { const [m, r] = p.split(":"); return { maxGPerL: m === "*" ? null : Number(m), perHl: Number((r ?? "").replace(",", ".")) }; });
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="ex-rate-form" data-cat={categoryId}>
      <div className="space-y-1"><Label htmlFor={`rc-${categoryId}`}>Country</Label><Input id={`rc-${categoryId}`} className="h-9 w-16" value={v.country} onChange={(e) => setV({ ...v, country: e.target.value.toUpperCase() })} /></div>
      {sugar ? <div className="space-y-1"><Label htmlFor={`rb-${categoryId}`}>Bands (g/l:€/hl, * = rest)</Label><Input id={`rb-${categoryId}`} className="h-9 w-64" value={v.bands} onChange={(e) => setV({ ...v, bands: e.target.value })} /></div>
        : <div className="space-y-1"><Label htmlFor={`rr-${categoryId}`}>Rate (€)</Label><Input id={`rr-${categoryId}`} className="h-9 w-28" inputMode="decimal" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} /></div>}
      {tobacco && <div className="space-y-1"><Label htmlFor={`ra-${categoryId}`}>+ % of price</Label><Input id={`ra-${categoryId}`} className="h-9 w-20" inputMode="decimal" value={v.adv} onChange={(e) => setV({ ...v, adv: e.target.value })} /></div>}
      <div className="space-y-1"><Label htmlFor={`rf-${categoryId}`}>From</Label><Input id={`rf-${categoryId}`} type="date" className="h-9" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor={`rn-${categoryId}`}>Note</Label><Input id={`rn-${categoryId}`} className="h-9 w-48" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
      <Button size="sm" disabled={pending} onClick={() => run(() => addExciseRateAction({ categoryId, countryCode: v.country, rate: sugar ? 0 : v.rate, adValoremPct: v.adv || null, bands: sugar ? bands() : null, validFrom: v.from, note: v.note || null }), undefined, "Rate added")}><Spin on={pending} icon={Plus} /> Add rate</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

export function ShopCategoryExcise({ categoryId, value, inherited, options }: { categoryId: string; value: string | null; inherited: string | null; options: { id: string; name: string }[] }) {
  const { pending, error, run } = useRun();
  const [v, setV] = useState(value ?? "");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Select aria-label="Excise category" className="h-8" value={v} disabled={pending} data-testid="shop-cat-excise" onChange={(e) => { setV(e.target.value); run(() => setShopCategoryExciseAction({ categoryId, exciseCategoryId: e.target.value || null })); }}>
        <option value="">{inherited ? `From parent: ${options.find((o) => o.id === inherited)?.name ?? "—"}` : "— none —"}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </Select>
      <Msg error={error} />
    </span>
  );
}

export function LicenceTypeForm({ t }: { t?: { id: string; code: string; names: Record<string, string>; kinds: string[]; countries: string[]; needsNumber: boolean; hasExpiry: boolean; active: boolean } }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ code: t?.code ?? "", en: t?.names.en ?? "", pt: t?.names.pt ?? "", kinds: t?.kinds ?? ["ALCOHOL"], countries: t?.countries.join(" ") ?? "", needsNumber: t?.needsNumber ?? true, hasExpiry: t?.hasExpiry ?? true, active: t?.active ?? true });
  const kind = (k: string) => <label key={k} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={v.kinds.includes(k)} onChange={(e) => setV({ ...v, kinds: e.target.checked ? [...v.kinds, k] : v.kinds.filter((x) => x !== k) })} /> {k.toLowerCase()}</label>;
  return (
    <div className="space-y-2" data-testid="licence-type-form">
      <div className="grid gap-2 sm:grid-cols-4">
        <Input aria-label="Code" placeholder="CODE" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} />
        <Input aria-label="Name (English)" placeholder="Name (English)" value={v.en} onChange={(e) => setV({ ...v, en: e.target.value })} />
        <Input aria-label="Name (Portuguese)" placeholder="Name (Portuguese)" value={v.pt} onChange={(e) => setV({ ...v, pt: e.target.value })} />
        <Input aria-label="Countries" placeholder="Countries (empty = all)" value={v.countries} onChange={(e) => setV({ ...v, countries: e.target.value })} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {["ALCOHOL", "TOBACCO", "VAPING"].map(kind)}
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={v.needsNumber} onChange={(e) => setV({ ...v, needsNumber: e.target.checked })} /> number</label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={v.hasExpiry} onChange={(e) => setV({ ...v, hasExpiry: e.target.checked })} /> expiry</label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> active</label>
        <Button size="sm" disabled={pending} onClick={() => run(() => saveLicenceTypeAction({ id: t?.id ?? null, code: v.code, nameEn: v.en, namePt: v.pt || null, kinds: v.kinds as ("ALCOHOL" | "TOBACCO" | "VAPING")[], countries: codes(v.countries), needsNumber: v.needsNumber, hasExpiry: v.hasExpiry, active: v.active }), undefined, "Saved")}><Spin on={pending} icon={Save} /> {t ? "Save" : "Add licence type"}</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function LicenceReview({ id, status, expiresOn }: { id: string; status: string; expiresOn: string | null }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  const [exp, setExp] = useState(expiresOn ?? "");
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="licence-review" data-licence={id}>
      {status === "PENDING" && <Input aria-label="Valid until" type="date" className="h-8 w-40" value={exp} onChange={(e) => setExp(e.target.value)} />}
      <Input aria-label="Note" placeholder={status === "PENDING" ? "Note (needed to reject)" : "Reason (needed to revoke)"} className="h-8 w-56 max-w-full" value={note} onChange={(e) => setNote(e.target.value)} />
      {status === "PENDING" && <>
        <Button size="sm" disabled={pending} data-testid="licence-approve" onClick={() => run(() => reviewLicenceAction({ id, decision: "APPROVE", expiresOn: exp || null, note: note || null }))}><Spin on={pending} icon={ShieldCheck} /> Approve</Button>
        <Button size="sm" variant="outline" disabled={pending} data-testid="licence-reject" onClick={() => run(() => reviewLicenceAction({ id, decision: "REJECT", note }))}><ShieldX className="size-4" /> Reject</Button>
      </>}
      {status === "APPROVED" && <Button size="sm" variant="outline" disabled={pending} data-testid="licence-revoke" onClick={() => run(() => reviewLicenceAction({ id, decision: "REVOKE", note }))}><Undo2 className="size-4" /> Revoke</Button>}
      <Msg error={error} />
    </div>
  );
}

export function RecordLicenceForm({ companies, types }: { companies: { id: string; name: string }[]; types: { id: string; name: string }[] }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ companyId: companies[0]?.id ?? "", typeId: types[0]?.id ?? "", number: "", issuer: "", expiresOn: "" });
  return (
    <div className="space-y-2" data-testid="record-licence-form">
      <div className="grid gap-2 sm:grid-cols-5">
        <Select aria-label="Customer" value={v.companyId} onChange={(e) => setV({ ...v, companyId: e.target.value })}>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select aria-label="Licence" value={v.typeId} onChange={(e) => setV({ ...v, typeId: e.target.value })}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        <Input aria-label="Number" placeholder="Number" value={v.number} onChange={(e) => setV({ ...v, number: e.target.value })} />
        <Input aria-label="Issued by" placeholder="Issued by" value={v.issuer} onChange={(e) => setV({ ...v, issuer: e.target.value })} />
        <Input aria-label="Valid until" type="date" value={v.expiresOn} onChange={(e) => setV({ ...v, expiresOn: e.target.value })} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={pending || !v.companyId} onClick={() => run(() => recordLicenceAction({ ...v, expiresOn: v.expiresOn || null }), () => setV({ ...v, number: "", issuer: "", expiresOn: "" }), "Recorded")}><Spin on={pending} icon={Check} /> Record (approved)</Button>
        <span className="text-xs text-muted-foreground">For a licence FIRINGI has seen on paper or checked in a registry.</span>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}
