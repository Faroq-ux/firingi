"use client";
/** Pre-orders & price locks (Phase 71) — FIRINGI's controls (English): review, cancel, settings, per-company switch, run the job. */
import { useEffect, useState } from "react";
import { Ban, Check, Play, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { cancelCampaignAction, cancelLockAction, reviewCampaignAction, reviewLockAction, runPreordersJobAction, savePreSettingsAction, setCompanyPreAction } from "@/server/actions/preorders";
import { findTenderBusinessAction } from "@/server/actions/tenders";

export function ReviewCampaign({ id }: { id: string }) {
  const { pending, error, done, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="ap-review">
      <div className="min-w-0 flex-1 basis-60 space-y-1"><Label htmlFor="ap-note" className="text-xs">Note to the supplier (required to reject)</Label><Input id="ap-note" value={note} onChange={(e) => setNote(e.target.value)} data-testid="ap-note" /></div>
      <Button disabled={pending} onClick={() => run(() => reviewCampaignAction({ id, approve: true, note: note || null }), undefined, "Approved — the pre-order is open.")} data-testid="ap-approve"><Spin on={pending} icon={Check} /> Approve</Button>
      <Button variant="outline" disabled={pending} onClick={() => run(() => reviewCampaignAction({ id, approve: false, note }), undefined, "Rejected.")} data-testid="ap-reject"><X className="size-4" /> Reject</Button>
      <Msg error={error} done={done} />
    </div>
  );
}
export function AdminCancelCampaign({ id }: { id: string }) {
  const { pending, error, done, run } = useRun();
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Input className="max-w-md" placeholder="Why FIRINGI cancels it (the buyers are told)" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="ap-cancel-reason" />
      <Button variant="destructive" disabled={pending} onClick={() => run(() => cancelCampaignAction({ id, reason }), undefined, "Cancelled.")} data-testid="ap-cancel"><Ban className="size-4" /> Cancel pre-order</Button>
      <Msg error={error} done={done} />
    </div>
  );
}
export function ReviewLock({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Button size="sm" disabled={pending} onClick={() => run(() => reviewLockAction({ id, approve: true }))} data-testid="al-approve"><Check className="size-4" /> Approve</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reviewLockAction({ id, approve: false, note: "Not approved by FIRINGI" }))} data-testid="al-reject"><X className="size-4" /> Reject</Button>
      <Msg error={error} />
    </span>
  );
}
export function AdminCancelLock({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  return <span className="inline-flex items-center gap-1"><Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelLockAction({ id }))} data-testid="al-cancel"><Ban className="size-4" /> Cancel</Button><Msg error={error} /></span>;
}
export function RunJob() {
  const { pending, error, done, run } = useRun();
  return <span className="inline-flex items-center gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => runPreordersJobAction({}), undefined, "Done.")} data-testid="ap-run"><Spin on={pending} icon={Play} /> Run now</Button><Msg error={error} done={done} /></span>;
}

export type PreForm = {
  enabled: boolean; sellers: { DISTRIBUTOR: boolean; WHOLESALER: boolean }; parts: { campaigns: boolean; priceLocks: boolean; deposits: boolean; ai: boolean };
  kinds: { SEASONAL: boolean; LAUNCH: boolean; SCARCE: boolean }; approval: "ALWAYS" | "AUTO";
  maxCampaignDays: number; maxDeliveryDates: number; maxDepositPct: number; maxLockMonths: number; lockReviewAbove: number; orderDaysBefore: number; confirmDays: number; lockRemindDays: number; offCountries: string[];
};
function Box({ label, hint, checked, onChange, testid }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; testid?: string }) {
  return <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>;
}
function Num({ label, value, onChange, hint, testid }: { label: string; value: number; onChange: (v: number) => void; hint?: string; testid?: string }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={testid} />{hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}</div>;
}
export function PreSettingsForm({ initial }: { initial: PreForm }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const [countries, setCountries] = useState(initial.offCountries.join(", "));
  const set = <K extends keyof PreForm>(k: K, v: PreForm[K]) => setS({ ...s, [k]: v });
  return (
    <form className="space-y-6" data-testid="aps-form" onSubmit={(e) => { e.preventDefault(); run(() => savePreSettingsAction({ input: { ...s, offCountries: countries.split(/[\s,;]+/).filter(Boolean) } }), undefined, "Saved."); }}>
      <Box label="Pre-orders & price locks are on" hint="Off: the pages, the job and the messages stop (pre-orders already placed stay as they are)." checked={s.enabled} onChange={(v) => set("enabled", v)} testid="aps-enabled" />
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-2"><h3 className="text-sm font-semibold">Who may offer them</h3>
          <Box label="Distributors (to wholesalers)" checked={s.sellers.DISTRIBUTOR} onChange={(v) => set("sellers", { ...s.sellers, DISTRIBUTOR: v })} testid="aps-dist" />
          <Box label="Wholesalers (to customers)" checked={s.sellers.WHOLESALER} onChange={(v) => set("sellers", { ...s.sellers, WHOLESALER: v })} testid="aps-whs" />
        </section>
        <section className="space-y-2"><h3 className="text-sm font-semibold">Parts</h3>
          <Box label="Pre-order campaigns" checked={s.parts.campaigns} onChange={(v) => set("parts", { ...s.parts, campaigns: v })} testid="aps-campaigns" />
          <Box label="Price locks" checked={s.parts.priceLocks} onChange={(v) => set("parts", { ...s.parts, priceLocks: v })} testid="aps-locks" />
          <Box label="Deposits" hint="Paid online, kept as credit and used on the invoices" checked={s.parts.deposits} onChange={(v) => set("parts", { ...s.parts, deposits: v })} testid="aps-deposits" />
          <Box label="AI (Assistant)" checked={s.parts.ai} onChange={(v) => set("parts", { ...s.parts, ai: v })} />
        </section>
        <section className="space-y-2"><h3 className="text-sm font-semibold">Kinds of pre-order</h3>
          <Box label="Seasonal" checked={s.kinds.SEASONAL} onChange={(v) => set("kinds", { ...s.kinds, SEASONAL: v })} />
          <Box label="New product launch" checked={s.kinds.LAUNCH} onChange={(v) => set("kinds", { ...s.kinds, LAUNCH: v })} />
          <Box label="Short supply" checked={s.kinds.SCARCE} onChange={(v) => set("kinds", { ...s.kinds, SCARCE: v })} />
          <div className="space-y-1 pt-2"><Label className="text-xs" htmlFor="aps-approval">Approval</Label><Select id="aps-approval" value={s.approval} onChange={(e) => set("approval", e.target.value as PreForm["approval"])} data-testid="aps-approval"><option value="ALWAYS">FIRINGI approves every pre-order</option><option value="AUTO">Pre-orders open without review</option></Select></div>
        </section>
      </div>
      <section className="space-y-2"><h3 className="text-sm font-semibold">Rules</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Num label="Longest order window (days)" value={s.maxCampaignDays} onChange={(v) => set("maxCampaignDays", v)} />
          <Num label="Delivery dates per pre-order" value={s.maxDeliveryDates} onChange={(v) => set("maxDeliveryDates", v)} />
          <Num label="Highest deposit (%)" value={s.maxDepositPct} onChange={(v) => set("maxDepositPct", v)} testid="aps-maxdep" />
          <Num label="Longest price lock (months)" value={s.maxLockMonths} onChange={(v) => set("maxLockMonths", v)} testid="aps-maxmonths" />
          <Num label="FIRINGI approves locks above (€)" value={s.lockReviewAbove} onChange={(v) => set("lockReviewAbove", v)} hint="0 = never" testid="aps-review-above" />
          <Num label="Place orders days before delivery" value={s.orderDaysBefore} onChange={(v) => set("orderDaysBefore", v)} />
          <Num label="Days to accept a smaller quantity" value={s.confirmDays} onChange={(v) => set("confirmDays", v)} hint="Then accepted automatically" />
          <Num label="Lock reminder days before the end" value={s.lockRemindDays} onChange={(v) => set("lockRemindDays", v)} />
        </div>
      </section>
      <div className="space-y-1"><Label htmlFor="aps-countries">Countries left out</Label><Input id="aps-countries" placeholder="e.g. LU, MT" value={countries} onChange={(e) => setCountries(e.target.value.toUpperCase())} data-testid="aps-countries" /></div>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={pending} data-testid="aps-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function CompanyPreSwitch({ companyId, state: initial }: { companyId: string; state: "DEFAULT" | "ON" | "OFF" }) {
  const { pending, error, run } = useRun();
  const [state, setState] = useState(initial);
  return (
    <span className="inline-flex items-center gap-1">
      <Select aria-label="Pre-orders & price locks for this company" value={state} disabled={pending} className="h-8 w-44" data-testid="aps-company"
        onChange={(e) => { const v = e.target.value as typeof state; const prev = state; setState(v); run(async () => { const r = await setCompanyPreAction({ companyId, value: v === "DEFAULT" ? null : v }); if (!r.ok) setState(prev); return r; }); }}>
        <option value="DEFAULT">Default (settings)</option><option value="ON">Always on</option><option value="OFF">Off</option>
      </Select>
      <Msg error={error} />
    </span>
  );
}
export function FindPreBusiness() {
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ id: string; name: string; type: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => { const r = await findTenderBusinessAction({ q }); if (r.ok) setHits(r.data as typeof hits); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-2">
      <Input placeholder="Find a company by name or NIF…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="aps-find" />
      {hits.length > 0 && <ul className="divide-y rounded-lg border">{hits.map((h) => <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid="aps-hit"><span className="min-w-0 flex-1 break-words">{h.name} <span className="text-xs text-muted-foreground">· {h.type.toLowerCase()}</span></span><CompanyPreSwitch companyId={h.id} state="DEFAULT" /></li>)}</ul>}
    </div>
  );
}
