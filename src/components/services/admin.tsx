"use client";
/** FIRINGI's Services admin (Phase 68, English): catalogue, providers, plans, money and settings. */
import { useEffect, useState } from "react";
import { Check, FileText, Pencil, Plus, Save, ShieldOff, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  addFiringiProviderAction, decideProviderAction, invoiceServiceCommissionsAction, markServicePaidAction, reassignServicePlanAction, saveServiceTypeAction,
  saveServicesSettingsAction, setCompanyServicesAction,
} from "@/server/actions/services";
import { findTenderBusinessAction } from "@/server/actions/tenders";
import type { ServicesSettings } from "@/server/servicing/settings";

const FREQ: Record<string, string> = { WEEKLY: "Every week", BIWEEKLY: "Every 2 weeks", TWICE_MONTHLY: "Twice a month", MONTHLY: "Every month", QUARTERLY: "Every 3 months", HALF_YEARLY: "Every 6 months", ON_REQUEST: "Only when requested" };
const UNITS: Record<string, string> = { L: "Litres", KG: "Kilograms", BIN: "Bins", VISIT: "Per visit" };
const box = "space-y-4 rounded-lg border bg-muted/20 p-4";

function Box({ label, checked, onChange, hint, testid }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; testid?: string }) {
  return <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>;
}
function Num({ label, value, onChange, hint, testid, step = 0.01 }: { label: string; value: number; onChange: (v: number) => void; hint?: string; testid?: string; step?: number }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><Input type="number" min={0} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={testid} />{hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}</div>;
}

// ── catalogue ───────────────────────────────────────────────────────────────

export type TypeDraft = {
  code: string; name: string; namePt: string; description: string; kind: "COLLECTION" | "VISIT" | "PRINT"; allowExtras: boolean; unit: string; isOil: boolean; wasteCode: string; needsDocument: boolean; frequencies: string[];
  feeNet: number; pricePerUnit: number; buybackPerUnit: number; providerPerVisit: number; providerPerUnit: number; invoicedBy: "FIRINGI" | "PROVIDER"; commissionPct: number; commissionPerVisit: number; commissionPerUnit: number;
  countries: string; active: boolean;
};
const EMPTY_TYPE: TypeDraft = {
  code: "", name: "", namePt: "", description: "", kind: "VISIT", allowExtras: false, unit: "VISIT", isOil: false, wasteCode: "", needsDocument: false, frequencies: ["MONTHLY", "ON_REQUEST"],
  feeNet: 0, pricePerUnit: 0, buybackPerUnit: 0, providerPerVisit: 0, providerPerUnit: 0, invoicedBy: "FIRINGI", commissionPct: 15, commissionPerVisit: 0, commissionPerUnit: 0, countries: "", active: true,
};

export function TypeEditor({ id, initial = EMPTY_TYPE }: { id: string | null; initial?: TypeDraft }) {
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(initial);
  const set = <K extends keyof TypeDraft>(k: K, v: TypeDraft[K]) => setT({ ...t, [k]: v });
  if (!open) return id ? <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="svt-edit"><Pencil className="size-4" /> Edit</Button> : <Button size="sm" onClick={() => setOpen(true)} data-testid="svt-new"><Plus className="size-4" /> Add a service</Button>;
  const prov = t.invoicedBy === "PROVIDER";
  return (
    <form className={box} data-testid="svt-form" onSubmit={(e) => { e.preventDefault(); run(() => saveServiceTypeAction({ id, input: { ...t, namePt: t.namePt || null, description: t.description || null, wasteCode: t.wasteCode || null, countries: t.countries.split(/[\s,;]+/).filter(Boolean) } }), () => setOpen(false)); }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1"><Label className="text-xs">Code</Label><Input value={t.code} disabled={!!id} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="e.g. DRAIN_CLEANING" data-testid="svt-code" /></div>
        <div className="space-y-1"><Label className="text-xs">Name (English)</Label><Input value={t.name} onChange={(e) => set("name", e.target.value)} data-testid="svt-name" /></div>
        <div className="space-y-1"><Label className="text-xs">Name (Portuguese)</Label><Input value={t.namePt} onChange={(e) => set("namePt", e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">Kind</Label><Select value={t.kind} onChange={(e) => setT({ ...t, kind: e.target.value as TypeDraft["kind"], unit: e.target.value === "VISIT" ? "VISIT" : t.unit === "VISIT" ? "L" : t.unit })} data-testid="svt-kind"><option value="COLLECTION">Collection (a quantity is taken)</option><option value="VISIT">Visit (a job is done)</option><option value="PRINT">Printing (orders from print suppliers&apos; products)</option></Select></div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-4"><Label className="text-xs">Description (shown to customers)</Label><Input value={t.description} maxLength={1000} onChange={(e) => set("description", e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">Unit</Label><Select value={t.unit} onChange={(e) => set("unit", e.target.value)} data-testid="svt-unit">{Object.entries(UNITS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
        <div className="space-y-1"><Label className="text-xs">Waste code (LER / EWC)</Label><Input value={t.wasteCode} onChange={(e) => set("wasteCode", e.target.value)} placeholder="20 01 25" /></div>
        <div className="space-y-1"><Label className="text-xs">Countries (empty = all)</Label><Input value={t.countries} onChange={(e) => set("countries", e.target.value.toUpperCase())} placeholder="PT, ES" /></div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Box label="Used cooking oil (fryers page, auto request)" checked={t.isOil} onChange={(v) => set("isOil", v)} />
        <Box label="Needs a licence and a signed document" checked={t.needsDocument} onChange={(v) => set("needsDocument", v)} testid="svt-doc" />
        <Box label="Active (customers can see it)" checked={t.active} onChange={(v) => set("active", v)} testid="svt-active" />
        {t.kind === "VISIT" && <Box label="Technician may add parts & labour (repairs)" checked={t.allowExtras} onChange={(v) => set("allowExtras", v)} hint="Charged to the customer on the visit; FIRINGI keeps its commission % of them." testid="svt-extras" />}
      </div>
      {t.kind === "PRINT" && <p className="text-xs text-muted-foreground">Print suppliers set their own products and prices; FIRINGI decides who invoices and the commission % below.</p>}
      {t.kind !== "PRINT" && <div className="space-y-1"><p className="text-xs font-medium">Schedules customers can choose</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">{Object.entries(FREQ).map(([k, v]) => <Box key={k} label={v} checked={t.frequencies.includes(k)} onChange={(on) => set("frequencies", on ? [...t.frequencies, k] : t.frequencies.filter((x) => x !== k))} testid={`svt-freq-${k}`} />)}</div></div>}
      <div className="space-y-2">
        <p className="text-xs font-medium">Who invoices the customer</p>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name={`by-${id ?? "new"}`} checked={!prov} onChange={() => set("invoicedBy", "FIRINGI")} data-testid="svt-by-FIRINGI" /> FIRINGI invoices the customer and pays the provider</label>
          <label className="flex items-center gap-2"><input type="radio" name={`by-${id ?? "new"}`} checked={prov} onChange={() => set("invoicedBy", "PROVIDER")} data-testid="svt-by-PROVIDER" /> The provider invoices the customer — FIRINGI earns a commission only</label>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Num label="Customer pays per visit (€, net)" value={t.feeNet} onChange={(v) => set("feeNet", v)} testid="svt-fee" />
        <Num label="Customer pays per unit (€)" value={t.pricePerUnit} onChange={(v) => set("pricePerUnit", v)} />
        <Num label="Paid to the customer per unit (€)" value={t.buybackPerUnit} onChange={(v) => set("buybackPerUnit", v)} hint="e.g. used oil bought back" testid="svt-buyback" />
        {!prov && <Num label="FIRINGI pays the provider per visit (€)" value={t.providerPerVisit} onChange={(v) => set("providerPerVisit", v)} testid="svt-prov-visit" />}
        {!prov && <Num label="FIRINGI pays the provider per unit (€)" value={t.providerPerUnit} onChange={(v) => set("providerPerUnit", v)} />}
        {prov && <Num label="Commission % of the customer charge" step={0.5} value={t.commissionPct} onChange={(v) => set("commissionPct", v)} testid="svt-comm-pct" />}
        {prov && <Num label="Commission per visit (€)" value={t.commissionPerVisit} onChange={(v) => set("commissionPerVisit", v)} />}
        {prov && <Num label="Commission per unit (€)" value={t.commissionPerUnit} onChange={(v) => set("commissionPerUnit", v)} />}
      </div>
      <p className="text-xs text-muted-foreground">{prov ? "Commission is invoiced to the provider monthly; customers never see it." : "FIRINGI's margin is the customer charge minus the provider's amount; customers never see the provider's amount."}</p>
      <div className="flex flex-wrap items-center gap-2"><Button type="submit" disabled={pending} data-testid="svt-save"><Spin on={pending} icon={Save} /> Save</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Msg error={error} /></div>
    </form>
  );
}

// ── providers ───────────────────────────────────────────────────────────────

export function DecideProvider({ id, status, invoicedBy, commissionPct, typeInvoicedBy }: { id: string; status: string; invoicedBy: string | null; commissionPct: number | null; typeInvoicedBy: string }) {
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ invoicedBy: invoicedBy ?? "", commissionPct: commissionPct == null ? "" : String(commissionPct), note: "" });
  const send = (approve: boolean, suspend = false) => run(() => decideProviderAction({ id, approve, suspend, note: v.note || null, invoicedBy: (v.invoicedBy || "") as "" | "FIRINGI" | "PROVIDER", commissionPct: v.commissionPct === "" ? null : Number(v.commissionPct) }), () => setOpen(false));
  if (!open) return (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant={status === "PENDING" ? "default" : "outline"} onClick={() => setOpen(true)} data-testid="svp-decide">{status === "PENDING" ? "Review" : "Terms"}</Button>
      {status === "APPROVED" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => send(false, true)} data-testid="svp-suspend"><Spin on={pending} icon={ShieldOff} /> Suspend</Button>}
      <Msg error={error} />
    </div>
  );
  return (
    <div className={box} data-testid="svp-form">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label className="text-xs">Who invoices the customer</Label>
          <Select value={v.invoicedBy} onChange={(e) => setV({ ...v, invoicedBy: e.target.value })} data-testid="svp-by"><option value="">As the service ({typeInvoicedBy === "PROVIDER" ? "provider" : "FIRINGI"})</option><option value="FIRINGI">FIRINGI</option><option value="PROVIDER">The provider (commission only)</option></Select></div>
        <div className="space-y-1"><Label className="text-xs">Commission % (empty = the service&apos;s)</Label><Input type="number" min={0} max={100} step={0.5} value={v.commissionPct} onChange={(e) => setV({ ...v, commissionPct: e.target.value })} data-testid="svp-pct" /></div>
        <div className="space-y-1"><Label className="text-xs">Note to the provider</Label><Input value={v.note} maxLength={500} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending} onClick={() => send(true)} data-testid="svp-approve"><Spin on={pending} icon={Check} /> Approve</Button>
        {status !== "REJECTED" && <Button size="sm" variant="destructive" disabled={pending} onClick={() => send(false)} data-testid="svp-reject"><X className="size-4" /> Reject</Button>}
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Msg error={error} />
      </div>
    </div>
  );
}

export function AddFiringiProvider({ types }: { types: { id: string; name: string }[] }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ serviceTypeId: types[0]?.id ?? "", countries: "PT" });
  if (!types.length) return null;
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => addFiringiProviderAction({ serviceTypeId: v.serviceTypeId, countries: v.countries.split(/[\s,;]+/).filter(Boolean) }), undefined, "FIRINGI now provides it."); }}>
      <div className="space-y-1"><Label className="text-xs">FIRINGI provides (own team)</Label><Select value={v.serviceTypeId} onChange={(e) => setV({ ...v, serviceTypeId: e.target.value })} data-testid="svp-firingi-type">{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></div>
      <div className="space-y-1"><Label className="text-xs">Countries</Label><Input className="w-32" value={v.countries} onChange={(e) => setV({ ...v, countries: e.target.value.toUpperCase() })} /></div>
      <Button type="submit" variant="outline" disabled={pending} data-testid="svp-firingi-add"><Spin on={pending} icon={UserPlus} /> Add</Button>
      <Msg error={error} done={done} />
    </form>
  );
}

export function ReassignPlan({ planId, providerId, options }: { planId: string; providerId: string | null; options: { id: string; label: string }[] }) {
  const { pending, error, run } = useRun();
  const [v, setV] = useState(providerId ?? "");
  if (options.length < 2) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Select aria-label="Provider" className="h-8 w-48" value={v} disabled={pending} onChange={(e) => { const next = e.target.value; setV(next); run(() => reassignServicePlanAction({ planId, providerId: next })); }} data-testid="svp-reassign">
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </Select>
      <Msg error={error} />
    </span>
  );
}

// ── money ───────────────────────────────────────────────────────────────────

export function MarkPaid({ ids, what, label }: { ids: string[]; what: "BUYBACK" | "PROVIDER"; label: string }) {
  const { pending, error, done, run } = useRun();
  if (!ids.length) return null;
  return <span className="inline-flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markServicePaidAction({ ids, what }), undefined, "Recorded.")} data-testid={`svm-paid-${what}`}><Spin on={pending} icon={Check} /> {label}</Button><Msg error={error} done={done} /></span>;
}
export function InvoiceCommissions({ disabled }: { disabled: boolean }) {
  const { pending, error, done, run } = useRun();
  return <span className="inline-flex flex-wrap items-center gap-2"><Button size="sm" disabled={pending || disabled} onClick={() => run(() => invoiceServiceCommissionsAction({}), (d) => void d, "Commission invoices issued.")} data-testid="svm-invoice"><Spin on={pending} icon={FileText} /> Invoice commissions now</Button><Msg error={error} done={done} /></span>;
}

// ── settings ────────────────────────────────────────────────────────────────

const PARTS: Record<keyof ServicesSettings["parts"], [string, string]> = {
  scheduled: ["Scheduled plans", "Every week, every 2 weeks, twice a month, every month."],
  onRequest: ["Requests", "Customers ask for a collection / visit when they need it."],
  oil: ["Fryers & oil", "Fryer log, oil-change alerts, container fill level, auto requests."],
  invoicing: ["FIRINGI invoices", "Issue FIRINGI's invoice to the customer when a visit is done (FIRINGI-invoiced services)."],
  buyback: ["Oil buy-back", "Pay customers for their used oil."],
  documents: ["Documents", "Signature and the visit document (collection note / service certificate)."],
  ai: ["AI", "Suggestions in the AI Centre and the Assistant (requests, schedules, licences)."],
};
export type ServicesForm = Omit<ServicesSettings, "companies">;
export function ServicesSettingsForm({ initial }: { initial: ServicesForm }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const set = <K extends keyof ServicesForm>(k: K, v: ServicesForm[K]) => setS({ ...s, [k]: v });
  return (
    <form className="space-y-6" data-testid="svs-form" onSubmit={(e) => { e.preventDefault(); run(() => saveServicesSettingsAction(s), undefined, "Saved."); }}>
      <Box label="Services are on" hint="Off: the pages, requests and the job stop; plans and history are kept." checked={s.enabled} onChange={(v) => set("enabled", v)} testid="svs-enabled" />
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-2"><h3 className="text-sm font-semibold">Who uses services</h3>
          <Box label="Customers (restaurants, shops)" checked={s.audiences.customers} onChange={(v) => set("audiences", { ...s.audiences, customers: v })} testid="svs-aud-customers" />
          <Box label="Wholesalers" checked={s.audiences.wholesalers} onChange={(v) => set("audiences", { ...s.audiences, wholesalers: v })} testid="svs-aud-wholesalers" />
          <h3 className="pt-2 text-sm font-semibold">Who may provide them</h3>
          <Box label="Distributors" checked={s.providers.distributors} onChange={(v) => set("providers", { ...s.providers, distributors: v })} testid="svs-prov-distributors" />
          <Box label="Wholesalers" checked={s.providers.wholesalers} onChange={(v) => set("providers", { ...s.providers, wholesalers: v })} testid="svs-prov-wholesalers" />
          <Box label="FIRINGI itself" checked={s.providers.firingi} onChange={(v) => set("providers", { ...s.providers, firingi: v })} testid="svs-prov-firingi" />
        </div>
        <div className="space-y-2 lg:col-span-2"><h3 className="text-sm font-semibold">Parts</h3>
          <div className="grid gap-2 sm:grid-cols-2">{(Object.keys(PARTS) as (keyof ServicesForm["parts"])[]).map((k) => <Box key={k} label={PARTS[k][0]} hint={PARTS[k][1]} checked={s.parts[k]} onChange={(v) => set("parts", { ...s.parts, [k]: v })} testid={`svs-part-${k}`} />)}</div>
        </div>
      </section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Oil rules</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Num label="Change the oil after (days)" step={1} value={s.oil.changeDays} onChange={(v) => set("oil", { ...s.oil, changeDays: v })} testid="svs-change-days" />
          <Num label="“Change soon” from polar %" step={1} value={s.oil.warnPolarPct} onChange={(v) => set("oil", { ...s.oil, warnPolarPct: v })} />
          <Num label="“Change now” at polar %" step={1} value={s.oil.maxPolarPct} onChange={(v) => set("oil", { ...s.oil, maxPolarPct: v })} hint="EU practice 24–27 %" />
          <Num label="Containers “full” at %" step={1} value={s.oil.fullPct} onChange={(v) => set("oil", { ...s.oil, fullPct: v })} hint="Auto request from this level" testid="svs-full" />
        </div>
      </section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Visits</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Num label="Remind before a visit (hours)" step={1} value={s.reminderHours} onChange={(v) => set("reminderHours", v)} />
          <Num label="Missed when not recorded after (hours)" step={1} value={s.missedAfterHours} onChange={(v) => set("missedAfterHours", v)} />
          <Num label="Plan visits ahead (days)" step={1} value={s.daysAhead} onChange={(v) => set("daysAhead", v)} />
          <Num label="Requests: earliest in (days)" step={1} value={s.requestLeadDays} onChange={(v) => set("requestLeadDays", v)} />
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={pending} data-testid="svs-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function CompanyServicesSwitch({ companyId, state: initial }: { companyId: string; state: "DEFAULT" | "ON" | "OFF" }) {
  const { pending, error, run } = useRun();
  const [state, setState] = useState(initial);
  return (
    <span className="inline-flex items-center gap-1">
      <Select aria-label="Services for this business" value={state} disabled={pending} className="h-8 w-40" data-testid="svs-company"
        onChange={(e) => { const v = e.target.value as typeof state; const prev = state; setState(v); run(async () => { const r = await setCompanyServicesAction({ companyId, value: v === "DEFAULT" ? null : v }); if (!r.ok) setState(prev); return r; }); }}>
        <option value="DEFAULT">Default (by type)</option><option value="ON">Always on</option><option value="OFF">Off</option>
      </Select>
      <Msg error={error} />
    </span>
  );
}
export function FindServicesBusiness() {
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ id: string; name: string; type: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => { const r = await findTenderBusinessAction({ q }); if (r.ok) setHits(r.data as typeof hits); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-2">
      <Input placeholder="Find a business by name or NIF…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="svs-find" />
      {hits.length > 0 && <ul className="divide-y rounded-lg border">{hits.map((h) => <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"><span className="min-w-0 flex-1 break-words">{h.name} <span className="text-xs text-muted-foreground">· {h.type.toLowerCase()}</span></span><CompanyServicesSwitch companyId={h.id} state="DEFAULT" /></li>)}</ul>}
    </div>
  );
}
