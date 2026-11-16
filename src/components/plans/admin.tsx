"use client";
/** FIRINGI's supplier-plan controls (Phase 36, English). */
import { useState } from "react";
import Link from "next/link";
import { Banknote, CalendarPlus, Check, Play, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  adminSetPlanAction, extendTrialAction, payEarlyPayoutAction, rejectEarlyPayoutAction, runPlansNowAction, savePlanAction, savePlansSettingsAction, setSubscriptionOptionsAction,
} from "@/server/actions/plans";
import { PLAN_FEATURE_LABEL, PLAN_FEATURES, type PlansSettings } from "@/lib/plans";

const TABS = [
  { href: "/admin/vendors/plans", label: "Overview & plans" },
  { href: "/admin/vendors/plans/subscribers", label: "Suppliers" },
  { href: "/admin/vendors/plans/early-payouts", label: "Early payouts" },
  { href: "/admin/vendors/plans/invoices", label: "Plan invoices" },
];
export function PlansTabs({ active, pending }: { active: string; pending?: number }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-2" aria-label="Supplier plans">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === active ? "page" : undefined}
          className={`rounded-full border px-3 py-1.5 text-sm transition ${t.href === active ? "border-transparent bg-[linear-gradient(90deg,var(--vivid-blue),var(--vivid-violet))] text-white shadow-sm" : "bg-card hover:border-[var(--vivid-violet)]"}`}>
          {t.label}{t.href.endsWith("/early-payouts") && pending ? <span className="ml-1.5 rounded-full bg-[var(--vivid-pink,#db2777)] px-1.5 text-xs text-white">{pending}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";

export function PlansSettingsForm({ settings, plans, canManage }: { settings: PlansSettings; plans: { code: string; name: string }[]; canManage: boolean }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(settings);
  const [rem, setRem] = useState(settings.reminderDays.join(", "));
  return (
    <form className="space-y-4" data-testid="plans-settings" onSubmit={(e) => { e.preventDefault(); run(() => savePlansSettingsAction({ ...v, reminderDays: rem.split(/[ ,;]+/).map(Number).filter((n) => n > 0) }), undefined, "Saved"); }}>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={v.enabled} disabled={!canManage} onChange={(e) => setV({ ...v, enabled: e.target.checked })} data-testid="plans-enabled" />
        <span><span className="font-medium">Plans on</span><span className="block text-xs text-muted-foreground">Every supplier then starts a free trial of the trial plan (all its features); at the end the plan it chose starts, or the default plan. Off: nothing is limited and no one is invoiced.</span></span></label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1"><Label htmlFor="pl-trial">Free trial (days)</Label><Input id="pl-trial" type="number" min={0} max={365} value={String(v.trialDays)} disabled={!canManage} onChange={(e) => setV({ ...v, trialDays: Number(e.target.value) })} /></div>
        <div className="space-y-1"><Label htmlFor="pl-trialplan">Trial plan</Label><select id="pl-trialplan" className={sel} value={v.trialPlanCode} disabled={!canManage} onChange={(e) => setV({ ...v, trialPlanCode: e.target.value })}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="pl-default">Default plan (no choice made)</Label><select id="pl-default" className={sel} value={v.defaultPlanCode} disabled={!canManage} onChange={(e) => setV({ ...v, defaultPlanCode: e.target.value })}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="pl-rem">Trial reminders (days before)</Label><Input id="pl-rem" value={rem} disabled={!canManage} onChange={(e) => setRem(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="pl-billing">New suppliers pay</Label><select id="pl-billing" className={sel} value={v.billing} disabled={!canManage} onChange={(e) => setV({ ...v, billing: e.target.value as "PAYOUT" | "INVOICE" })}><option value="PAYOUT">Deducted from payouts</option><option value="INVOICE">By invoice</option></select></div>
        <div className="space-y-1"><Label htmlFor="pl-due">Invoice terms (days)</Label><Input id="pl-due" type="number" min={0} max={90} value={String(v.invoiceDueDays)} disabled={!canManage} onChange={(e) => setV({ ...v, invoiceDueDays: Number(e.target.value) })} /></div>
      </div>
      <fieldset className="grid gap-3 rounded-xl border p-3 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold">Early payout</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.earlyPay.enabled} disabled={!canManage} onChange={(e) => setV({ ...v, earlyPay: { ...v.earlyPay, enabled: e.target.checked } })} data-testid="early-enabled" /> Offered to suppliers</label>
        <div className="space-y-1"><Label htmlFor="pl-elimit">Default limit per supplier (€ outstanding)</Label><Input id="pl-elimit" type="number" min={0} value={String(v.earlyPay.defaultLimit)} disabled={!canManage} onChange={(e) => setV({ ...v, earlyPay: { ...v.earlyPay, defaultLimit: Number(e.target.value) } })} /></div>
        <div className="space-y-1"><Label htmlFor="pl-emin">Only invoices due in at least (days)</Label><Input id="pl-emin" type="number" min={1} max={60} value={String(v.earlyPay.minDaysEarly)} disabled={!canManage} onChange={(e) => setV({ ...v, earlyPay: { ...v.earlyPay, minDaysEarly: Number(e.target.value) } })} /></div>
      </fieldset>
      {canManage && <div className="flex items-center gap-3"><Button type="submit" disabled={pending} data-testid="plans-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>}
    </form>
  );
}

export type PlanRow = {
  id: string; code: string; name: string; description: string | null; monthlyPrice: number; commissionPct: number | null; features: string[];
  maxProducts: number | null; maxUsers: number | null; maxWarehouses: number | null; maxDrivers: number | null;
  earlyPayModel: "OFF" | "PER_DAY" | "FLAT"; earlyPayRate: number; earlyPayMinFee: number; freeEarlyPays: number; active: boolean; sortOrder: number;
};
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

export function PlanEditor({ plan, canManage }: { plan: PlanRow | null; canManage: boolean }) {
  const { pending, error, done, run } = useRun();
  const blank: PlanRow = { id: "", code: "", name: "", description: "", monthlyPrice: 0, commissionPct: null, features: [], maxProducts: null, maxUsers: null, maxWarehouses: null, maxDrivers: null, earlyPayModel: "OFF", earlyPayRate: 0, earlyPayMinFee: 0, freeEarlyPays: 0, active: true, sortOrder: 9 };
  const [v, setV] = useState<PlanRow>(plan ?? blank);
  const [s, setS] = useState({ commission: v.commissionPct === null ? "" : String(v.commissionPct), products: v.maxProducts?.toString() ?? "", users: v.maxUsers?.toString() ?? "", warehouses: v.maxWarehouses?.toString() ?? "", drivers: v.maxDrivers?.toString() ?? "" });
  const k = plan?.code ?? "new";
  const toggle = (f: string) => setV({ ...v, features: v.features.includes(f) ? v.features.filter((x) => x !== f) : [...v.features, f] });
  return (
    <form className="space-y-3" data-testid={`plan-editor-${k}`} onSubmit={(e) => {
      e.preventDefault();
      run(() => savePlanAction({
        id: plan?.id ?? null, code: v.code, name: v.name, description: v.description || null, monthlyPrice: Number(v.monthlyPrice), commissionPct: numOrNull(s.commission),
        features: v.features as (typeof PLAN_FEATURES)[number][], maxProducts: numOrNull(s.products), maxUsers: numOrNull(s.users), maxWarehouses: numOrNull(s.warehouses), maxDrivers: numOrNull(s.drivers),
        earlyPayModel: v.earlyPayModel, earlyPayRate: Number(v.earlyPayRate), earlyPayMinFee: Number(v.earlyPayMinFee), freeEarlyPays: Number(v.freeEarlyPays), active: v.active, sortOrder: Number(v.sortOrder),
      }), undefined, "Saved");
    }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1"><Label htmlFor={`${k}-code`}>Code</Label><Input id={`${k}-code`} value={v.code} disabled={!canManage || !!plan} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} /></div>
        <div className="space-y-1"><Label htmlFor={`${k}-name`}>Name</Label><Input id={`${k}-name`} value={v.name} disabled={!canManage} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor={`${k}-price`}>Monthly price (€, excl. VAT)</Label><Input id={`${k}-price`} type="number" step="0.01" min={0} value={String(v.monthlyPrice)} disabled={!canManage} onChange={(e) => setV({ ...v, monthlyPrice: Number(e.target.value) })} data-testid={`${k}-price`} /></div>
        <div className="space-y-1"><Label htmlFor={`${k}-comm`}>Commission % (empty = each supplier&apos;s own)</Label><Input id={`${k}-comm`} type="number" step="0.1" min={0} max={50} value={s.commission} disabled={!canManage} onChange={(e) => setS({ ...s, commission: e.target.value })} data-testid={`${k}-commission`} /></div>
      </div>
      <div className="space-y-1"><Label htmlFor={`${k}-desc`}>Description (suppliers see it)</Label><Input id={`${k}-desc`} value={v.description ?? ""} disabled={!canManage} onChange={(e) => setV({ ...v, description: e.target.value })} /></div>
      <fieldset className="grid gap-1.5 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium">Features</legend>
        {PLAN_FEATURES.map((f) => <label key={f} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={v.features.includes(f)} disabled={!canManage} onChange={() => toggle(f)} data-testid={`${k}-f-${f}`} /> {PLAN_FEATURE_LABEL[f]}</label>)}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-4">
        {(["products", "users", "warehouses", "drivers"] as const).map((x) => (
          <div key={x} className="space-y-1"><Label htmlFor={`${k}-${x}`}>Max {x} (empty = no limit)</Label><Input id={`${k}-${x}`} type="number" min={1} value={s[x]} disabled={!canManage} onChange={(e) => setS({ ...s, [x]: e.target.value })} /></div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1"><Label htmlFor={`${k}-em`}>Early payout fee</Label><select id={`${k}-em`} className={sel} value={v.earlyPayModel} disabled={!canManage} onChange={(e) => setV({ ...v, earlyPayModel: e.target.value as PlanRow["earlyPayModel"] })} data-testid={`${k}-early-model`}><option value="OFF">Not offered</option><option value="PER_DAY">% per day early</option><option value="FLAT">Flat % of the amount</option></select></div>
        <div className="space-y-1"><Label htmlFor={`${k}-er`}>{v.earlyPayModel === "FLAT" ? "Flat %" : "% per day"}</Label><Input id={`${k}-er`} type="number" step="0.001" min={0} value={String(v.earlyPayRate)} disabled={!canManage || v.earlyPayModel === "OFF"} onChange={(e) => setV({ ...v, earlyPayRate: Number(e.target.value) })} data-testid={`${k}-early-rate`} /></div>
        <div className="space-y-1"><Label htmlFor={`${k}-emf`}>Minimum fee (€)</Label><Input id={`${k}-emf`} type="number" step="0.5" min={0} value={String(v.earlyPayMinFee)} disabled={!canManage || v.earlyPayModel === "OFF"} onChange={(e) => setV({ ...v, earlyPayMinFee: Number(e.target.value) })} /></div>
        <div className="space-y-1"><Label htmlFor={`${k}-efree`}>Free early payouts a month</Label><Input id={`${k}-efree`} type="number" min={0} max={30} value={String(v.freeEarlyPays)} disabled={!canManage || v.earlyPayModel === "OFF"} onChange={(e) => setV({ ...v, freeEarlyPays: Number(e.target.value) })} data-testid={`${k}-early-free`} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.active} disabled={!canManage} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Offered to suppliers</label>
        <div className="flex items-center gap-2 text-sm"><Label htmlFor={`${k}-sort`}>Order</Label><Input id={`${k}-sort`} className="w-20" type="number" value={String(v.sortOrder)} disabled={!canManage} onChange={(e) => setV({ ...v, sortOrder: Number(e.target.value) })} /></div>
        {canManage && <Button type="submit" disabled={pending} data-testid={`${k}-save`}><Spin on={pending} icon={Save} /> {plan ? "Save plan" : "Add plan"}</Button>}
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

export function RunPlansButton() {
  const { pending, error, done, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="outline" disabled={pending} onClick={() => run(() => runPlansNowAction({}), undefined, "Done")} data-testid="plans-run"><Spin on={pending} icon={Play} /> Run now</Button>
      <Msg error={error} done={done} />
    </span>
  );
}

export function SubscriberControls({ companyId, name, plans, planId, status, billing, commissionLocked, earlyPayEnabled, earlyPayLimit }: {
  companyId: string; name: string; plans: { id: string; name: string }[]; planId: string; status: string; billing: "PAYOUT" | "INVOICE"; commissionLocked: boolean; earlyPayEnabled: boolean; earlyPayLimit: number | null;
}) {
  const { pending, error, done, run } = useRun();
  const [plan, setPlan] = useState(planId);
  const [now, setNow] = useState(true);
  const [limit, setLimit] = useState(earlyPayLimit === null ? "" : String(earlyPayLimit));
  return (
    <div className="flex flex-col gap-1.5" data-testid="sub-controls">
      <span className="inline-flex flex-wrap items-center gap-1">
        <select aria-label={`Plan for ${name}`} className="h-8 rounded-md border bg-background px-2 text-sm" value={plan} onChange={(e) => setPlan(e.target.value)} data-testid="sub-plan">{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={now} onChange={(e) => setNow(e.target.checked)} /> now</label>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => adminSetPlanAction({ companyId, planId: plan, immediate: now }), undefined, "Changed")} data-testid="sub-set"><Check className="size-4" /> Set</Button>
        {status === "TRIAL" && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => extendTrialAction({ companyId, days: 30 }), undefined, "Trial +30 days")} data-testid="sub-extend"><CalendarPlus className="size-4" /> +30 days</Button>}
      </span>
      <span className="inline-flex flex-wrap items-center gap-2 text-xs">
        <select aria-label={`How ${name} pays`} className="h-7 rounded-md border bg-background px-1 text-xs" defaultValue={billing} onChange={(e) => run(() => setSubscriptionOptionsAction({ companyId, billing: e.target.value as "PAYOUT" | "INVOICE" }))}><option value="PAYOUT">From payouts</option><option value="INVOICE">By invoice</option></select>
        <label className="flex items-center gap-1"><input type="checkbox" defaultChecked={commissionLocked} onChange={(e) => run(() => setSubscriptionOptionsAction({ companyId, commissionLocked: e.target.checked }))} data-testid="sub-lock" /> own commission</label>
        <label className="flex items-center gap-1"><input type="checkbox" defaultChecked={earlyPayEnabled} onChange={(e) => run(() => setSubscriptionOptionsAction({ companyId, earlyPayEnabled: e.target.checked }))} data-testid="sub-early" /> early payout</label>
        <Input aria-label={`Early payout limit for ${name}`} className="h-7 w-24 text-xs" type="number" min={0} placeholder="default €" value={limit} onChange={(e) => setLimit(e.target.value)}
          onBlur={() => run(() => setSubscriptionOptionsAction({ companyId, earlyPayLimit: limit.trim() === "" ? null : Number(limit) }))} data-testid="sub-limit" />
      </span>
      <Msg error={error} done={done} />
    </div>
  );
}

export function EarlyPayoutDecision({ id }: { id: string }) {
  const { pending, error, done, run } = useRun();
  const [ref, setRef] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid="early-decision">
      {!rejecting ? (
        <>
          <Input aria-label="Bank transfer reference" className="h-8 w-36" placeholder="Transfer ref." value={ref} onChange={(e) => setRef(e.target.value)} data-testid="early-ref" />
          <Button size="sm" disabled={pending} onClick={() => run(() => payEarlyPayoutAction({ id, reference: ref || null }), undefined, "Paid")} data-testid="early-pay"><Spin on={pending} icon={Banknote} /> Paid</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setRejecting(true)} data-testid="early-reject"><X className="size-4" /> Turn down</Button>
        </>
      ) : (
        <>
          <Input aria-label="Reason" className="h-8 w-56" placeholder="Why (the supplier sees it)" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="early-reason" />
          <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(() => rejectEarlyPayoutAction({ id, reason }))} data-testid="early-reject-confirm">Turn down</Button>
        </>
      )}
      <Msg error={error} done={done} />
    </span>
  );
}
