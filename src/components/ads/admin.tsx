"use client";
/** FIRINGI's sponsored-products controls (Phase 34, English): rules per placement, review, billing method, top-ups, invoicing. */
import { useState } from "react";
import Link from "next/link";
import { Check, Pause, Play, Receipt, Save, Square, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { invoiceAdsNowAction, recordTopUpAction, reviewCampaignAction, runAdsNowAction, saveAdsSettingsAction, setAdBillingAction } from "@/server/actions/ads";
import type { AdsSettings } from "@/server/ads/service";
import { BILLING_LABEL, PLACEMENT_LABEL } from "./labels";

const TABS = [
  { href: "/admin/marketing/ads", label: "Overview & rules" },
  { href: "/admin/marketing/ads/review", label: "To review" },
  { href: "/admin/marketing/ads/campaigns", label: "Campaigns" },
  { href: "/admin/marketing/ads/advertisers", label: "Advertisers & billing" },
  { href: "/admin/marketing/ads/invoices", label: "Ad invoices" },
];
export function AdsTabs({ active, pending }: { active: string; pending?: number }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-2" aria-label="Sponsored products">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === active ? "page" : undefined}
          className={`rounded-full border px-3 py-1.5 text-sm transition ${t.href === active ? "border-transparent bg-[linear-gradient(90deg,var(--vivid-blue),var(--vivid-violet))] text-white shadow-sm" : "bg-card hover:border-[var(--vivid-violet)]"}`}>
          {t.label}{t.href.endsWith("/review") && pending ? <span className="ml-1.5 rounded-full bg-[var(--vivid-pink,#db2777)] px-1.5 text-xs text-white">{pending}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

const num = (v: string) => (v.trim() === "" ? NaN : Number(v));

export function AdsSettingsForm({ settings, canManage }: { settings: AdsSettings; canManage: boolean }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(settings);
  const setP = (p: keyof AdsSettings["placements"], k: "enabled" | "slots" | "minCpc" | "dailyPrice", val: boolean | number) => setV({ ...v, placements: { ...v.placements, [p]: { ...v.placements[p], [k]: val } } });
  return (
    <form className="space-y-4" data-testid="ads-settings" onSubmit={(e) => { e.preventDefault(); run(() => saveAdsSettingsAction(v), undefined, "Saved"); }}>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={v.enabled} disabled={!canManage} onChange={(e) => setV({ ...v, enabled: e.target.checked })} data-testid="ads-enabled" /> Sponsored products on</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.approvalRequired} disabled={!canManage} onChange={(e) => setV({ ...v, approvalRequired: e.target.checked })} /> FIRINGI approves each campaign before it runs</label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(PLACEMENT_LABEL) as (keyof typeof PLACEMENT_LABEL)[]).map((p) => (
          <fieldset key={p} className="space-y-2 rounded-xl border p-3" data-testid={`placement-${p}`}>
            <legend className="px-1 text-sm font-semibold">{PLACEMENT_LABEL[p]}</legend>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.placements[p].enabled} disabled={!canManage} onChange={(e) => setP(p, "enabled", e.target.checked)} data-testid={`pl-${p}-on`} /> Ads shown here</label>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1"><Label htmlFor={`pl-${p}-slots`}>Slots</Label><Input id={`pl-${p}-slots`} type="number" min={1} max={8} value={String(v.placements[p].slots)} disabled={!canManage} onChange={(e) => setP(p, "slots", num(e.target.value))} /></div>
              <div className="space-y-1"><Label htmlFor={`pl-${p}-cpc`}>Min €/click</Label><Input id={`pl-${p}-cpc`} type="number" step="0.01" value={String(v.placements[p].minCpc)} disabled={!canManage} onChange={(e) => setP(p, "minCpc", num(e.target.value))} /></div>
              <div className="space-y-1"><Label htmlFor={`pl-${p}-day`}>€/day</Label><Input id={`pl-${p}-day`} type="number" step="0.5" value={String(v.placements[p].dailyPrice)} disabled={!canManage} onChange={(e) => setP(p, "dailyPrice", num(e.target.value))} /></div>
            </div>
          </fieldset>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="ads-billing">Default billing for new advertisers</Label>
          <select id="ads-billing" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={v.defaultBilling} disabled={!canManage} onChange={(e) => setV({ ...v, defaultBilling: e.target.value as AdsSettings["defaultBilling"] })}>
            {Object.entries(BILLING_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="space-y-1"><Label htmlFor="ads-due">Ad invoice terms (days)</Label><Input id="ads-due" type="number" value={String(v.invoiceDueDays)} disabled={!canManage} onChange={(e) => setV({ ...v, invoiceDueDays: num(e.target.value) })} /></div>
        <div className="space-y-1"><Label htmlFor="ads-dedupe">Repeat click not charged within (min)</Label><Input id="ads-dedupe" type="number" value={String(v.clickDedupeMinutes)} disabled={!canManage} onChange={(e) => setV({ ...v, clickDedupeMinutes: num(e.target.value) })} /></div>
        <div className="space-y-1"><Label htmlFor="ads-low">Warn prepaid balance below (€)</Label><Input id="ads-low" type="number" step="1" value={String(v.lowBalance)} disabled={!canManage} onChange={(e) => setV({ ...v, lowBalance: num(e.target.value) })} /></div>
      </div>
      <p className="text-xs text-muted-foreground">Prices exclude VAT. Booked days (per day) show first, then per-click ads by bid. A placement can&apos;t be booked by more campaigns than it has slots.</p>
      {canManage && <div className="flex items-center gap-3"><Button type="submit" disabled={pending} data-testid="ads-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>}
    </form>
  );
}

export function RunAdsButton() {
  const { pending, error, done, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="outline" disabled={pending} onClick={() => run(() => runAdsNowAction({}), undefined, "Done")} data-testid="ads-run"><Spin on={pending} icon={Play} /> Run now</Button>
      <Msg error={error} done={done} />
    </span>
  );
}

export function ReviewButtons({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid="review">
      <Button size="sm" disabled={pending} onClick={() => run(() => reviewCampaignAction({ id, decision: "APPROVE" }))} data-testid="approve"><Check className="size-4" /> Approve</Button>
      {rejecting ? (
        <>
          <Input aria-label="Reason" className="h-8 w-48" placeholder="Why (the supplier sees it)" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="reject-reason" />
          <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(() => reviewCampaignAction({ id, decision: "REJECT", reason }))} data-testid="reject-confirm">Reject</Button>
        </>
      ) : <Button size="sm" variant="outline" disabled={pending} onClick={() => setRejecting(true)} data-testid="reject"><X className="size-4" /> Reject</Button>}
      <Msg error={error} />
    </span>
  );
}

export function StaffCampaignActions({ id, status }: { id: string; status: string }) {
  const { pending, error, run } = useRun();
  if (status === "PENDING") return <ReviewButtons id={id} />;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {status === "ACTIVE" && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reviewCampaignAction({ id, decision: "PAUSE" }))} data-testid="staff-pause"><Pause className="size-4" /> Pause</Button>}
      {!["ENDED", "REJECTED"].includes(status) && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reviewCampaignAction({ id, decision: "END" }))} data-testid="staff-end"><Square className="size-4" /> End</Button>}
      <Msg error={error} />
    </span>
  );
}

export function BillingSelect({ companyId, billing, name }: { companyId: string; billing: keyof typeof BILLING_LABEL; name: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <select aria-label={`How FIRINGI collects from ${name}`} className="h-8 rounded-md border bg-background px-2 text-sm" defaultValue={billing} disabled={pending} data-testid="billing-select"
        onChange={(e) => run(() => setAdBillingAction({ companyId, billing: e.target.value as keyof typeof BILLING_LABEL }))}>
        {Object.entries(BILLING_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <Msg error={error} />
    </span>
  );
}

export function TopUpForm({ companyId, name }: { companyId: string; name: string }) {
  const { pending, error, done, run } = useRun();
  const [gross, setGross] = useState("");
  const [ref, setRef] = useState("");
  return (
    <form className="inline-flex flex-wrap items-center gap-1" data-testid="topup-form" onSubmit={(e) => { e.preventDefault(); run(() => recordTopUpAction({ companyId, gross: Number(gross), method: "BANK_TRANSFER", reference: ref || null }), () => { setGross(""); setRef(""); }, "Recorded — invoice-receipt issued"); }}>
      <Input aria-label={`Amount received from ${name} (€, incl. VAT)`} className="h-8 w-24" type="number" step="0.01" min="0.01" required placeholder="€ received" value={gross} onChange={(e) => setGross(e.target.value)} data-testid="topup-amount" />
      <Input aria-label="Bank reference" className="h-8 w-28" placeholder="Reference" value={ref} onChange={(e) => setRef(e.target.value)} />
      <Button size="sm" variant="outline" type="submit" disabled={pending} data-testid="topup-save"><Spin on={pending} icon={Wallet} /> Add credit</Button>
      <Msg error={error} done={done} />
    </form>
  );
}

export function InvoiceNowButton() {
  const { pending, error, done, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="outline" disabled={pending} data-testid="invoice-now"
        onClick={() => run(() => invoiceAdsNowAction({}), (d) => void d, "Done — ad costs up to today invoiced")}><Spin on={pending} icon={Receipt} /> Invoice ad costs now</Button>
      <Msg error={error} done={done} />
    </span>
  );
}
