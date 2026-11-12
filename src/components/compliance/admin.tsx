"use client";
/** FIRINGI compliance controls (Phase 28) — English, admin portal. */
import { useState } from "react";
import { Check, EyeOff, Eye, Plus, RefreshCw, Save, ShieldOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun, type Opt } from "@/components/shared/run";
import {
  approveCertificateAction, grantWaiverAction, markRecheckedAction, rejectCertificateAction, revokeCertificateAction, revokeWaiverAction,
  runComplianceCheckAction, saveCertificateTypeAction, setBadgeHiddenAction, setTypeBadgeAction,
} from "@/server/actions/compliance";
import { EMPTY_TYPE, type TypeDraft } from "@/lib/compliance";
import { setCompanyStatusAction } from "@/server/actions/admin-review";

const day = (d: string | Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const plus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export function Switch({ on, label, disabled, onToggle, testId }: { on: boolean; label: string; disabled?: boolean; onToggle: () => void; testId?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} data-testid={testId} onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${on ? "bg-[linear-gradient(90deg,var(--vivid-teal),var(--vivid-blue))]" : "bg-muted-foreground/30"}`}>
      <span className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}

/** Approve (with expiry / number / next re-check corrected from the file) or reject. */
export function ReviewCertificate({ id, status, expiresOn, number, hasExpiry, needsNumber, recheckDefault }: { id: string; status: string; expiresOn: string | null; number: string | null; hasExpiry: boolean; needsNumber: boolean; recheckDefault: string | null }) {
  const { pending, error, done, run } = useRun();
  const [exp, setExp] = useState(day(expiresOn));
  const [num, setNum] = useState(number ?? "");
  const [recheck, setRecheck] = useState(recheckDefault ?? "");
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  if (status !== "PENDING" && status !== "REJECTED") return null;
  return (
    <div className="space-y-3" data-testid="review-certificate">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5"><Label htmlFor="rc-num">Certificate number{needsNumber ? " *" : ""}</Label><Input id="rc-num" value={num} onChange={(e) => setNum(e.target.value)} /></div>
        {hasExpiry && <div className="space-y-1.5"><Label htmlFor="rc-exp">Valid until *</Label><Input id="rc-exp" type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></div>}
        <div className="space-y-1.5"><Label htmlFor="rc-re">Next re-check</Label><Input id="rc-re" type="date" value={recheck} onChange={(e) => setRecheck(e.target.value)} /></div>
      </div>
      <div className="space-y-1.5"><Label htmlFor="rc-note">Note {rejecting ? "(shown to the supplier) *" : "(optional)"}</Label><Input id="rc-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={rejecting ? "Why is it rejected?" : "e.g. checked with the issuer"} /></div>
      <div className="flex flex-wrap items-center gap-2">
        {!rejecting ? (
          <>
            <Button disabled={pending} data-testid="approve-cert" onClick={() => run(() => approveCertificateAction({ id, expiresOn: hasExpiry ? exp : null, number: num || null, recheckDueOn: recheck || null, note: note || null }), undefined, "Approved")}><Spin on={pending} icon={Check} />Approve</Button>
            {status === "PENDING" && <Button variant="outline" onClick={() => setRejecting(true)}><X className="size-4" />Reject…</Button>}
          </>
        ) : (
          <>
            <Button variant="destructive" disabled={pending || !note.trim()} data-testid="reject-cert" onClick={() => run(() => rejectCertificateAction({ id, note }), () => setRejecting(false), "Rejected")}>Confirm rejection</Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
          </>
        )}
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

/** Approved certificate: re-check, hide / show badge, revoke. */
export function CertificateActions({ id, status, badgeHidden, badgeEnabled }: { id: string; status: string; badgeHidden: boolean; badgeEnabled: boolean }) {
  const { pending, error, done, run } = useRun();
  const [revoking, setRevoking] = useState(false);
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === "APPROVED" && <Button size="sm" variant="outline" disabled={pending} data-testid="recheck" onClick={() => run(() => markRecheckedAction({ id }), undefined, "Re-check recorded")}><RefreshCw className="size-4" />Mark re-checked</Button>}
        {badgeEnabled && (status === "APPROVED" || status === "EXPIRED") && (
          <Button size="sm" variant="outline" disabled={pending} data-testid="toggle-badge" onClick={() => run(() => setBadgeHiddenAction({ id, hidden: !badgeHidden }), undefined, badgeHidden ? "Badge shown" : "Badge hidden")}>
            {badgeHidden ? <><Eye className="size-4" />Show badge to customers</> : <><EyeOff className="size-4" />Hide badge from customers</>}
          </Button>
        )}
        {(status === "APPROVED" || status === "EXPIRED") && !revoking && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRevoking(true)}><ShieldOff className="size-4" />Revoke…</Button>}
      </div>
      {revoking && (
        <div className="flex flex-wrap gap-2">
          <Input className="h-9 min-w-56 flex-1" placeholder="Reason (shown to the supplier)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" variant="destructive" disabled={pending || note.trim().length < 5} onClick={() => run(() => revokeCertificateAction({ id, note }), () => setRevoking(false), "Revoked")}>Revoke</Button>
          <Button size="sm" variant="ghost" onClick={() => setRevoking(false)}>Cancel</Button>
        </div>
      )}
      <Msg error={error} done={done} />
    </div>
  );
}

export function WaiverForm({ companyId, types }: { companyId: string; types: Opt[] }) {
  const { pending, error, done, run } = useRun();
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [until, setUntil] = useState(plus(30));
  const [reason, setReason] = useState("");
  if (!types.length) return <p className="text-sm text-muted-foreground">No certificate types apply to this supplier.</p>;
  return (
    <div className="space-y-3" data-testid="waiver-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="w-type">Certificate</Label><Select id="w-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></div>
        <div className="space-y-1.5"><Label htmlFor="w-until">Keep selling until</Label><Input id="w-until" type="date" value={until} min={plus(0)} max={plus(365)} onChange={(e) => setUntil(e.target.value)} /></div>
      </div>
      <div className="space-y-1.5"><Label htmlFor="w-reason">Reason (kept in the audit trail)</Label><Input id="w-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. renewal audit booked for 20 Nov" /></div>
      <div className="flex items-center gap-2">
        <Button disabled={pending || reason.trim().length < 10} onClick={() => run(() => grantWaiverAction({ companyId, typeId, until, reason }), () => setReason(""), "Grace period granted")}><Spin on={pending} icon={Plus} />Grant grace period</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function RevokeWaiver({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  return <span className="inline-flex items-center gap-2"><Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => run(() => revokeWaiverAction({ id }))}>End now</Button>{error && <span className="text-xs text-destructive">{error}</span>}</span>;
}

export function TypeBadgeSwitch({ id, enabled, name }: { id: string; enabled: boolean; name: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Switch on={enabled} label={`Verified badge for ${name}`} disabled={pending} testId={`badge-switch-${name}`} onToggle={() => run(() => setTypeBadgeAction({ id, enabled: !enabled }))} />
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

export function RunCheck() {
  const { pending, error, done, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} data-testid="run-check" onClick={() => run(() => runComplianceCheckAction({}), undefined, "Pauses re-applied")}><Spin on={pending} icon={RefreshCw} />Re-apply rules now</Button>
      <Msg error={error} done={done} />
    </span>
  );
}

function Multi({ id, label, options, value, onChange, hint }: { id: string; label: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void; hint: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} multiple value={value} onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))} className="h-28 w-full rounded-md border bg-background px-2 py-1 text-sm">
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Create / edit a certificate type (rules, pause, badge). */
export function TypeForm({ initial, countries, categories, onDone }: { initial: TypeDraft; countries: Opt[]; categories: Opt[]; onDone?: () => void }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState<TypeDraft>(initial);
  const set = <K extends keyof TypeDraft>(k: K, x: TypeDraft[K]) => setV((p) => ({ ...p, [k]: x }));
  const box = (k: "required" | "needsNumber" | "hasExpiry" | "badgeEnabled" | "publicDownload" | "isActive", text: string, hint?: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5 size-4" checked={v[k]} onChange={(e) => set(k, e.target.checked)} data-testid={`type-${k}`} />
      <span><span className="font-medium">{text}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
    </label>
  );
  const sup = (t: "DISTRIBUTOR" | "WHOLESALER") => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={v.appliesTo.includes(t)} onChange={(e) => set("appliesTo", e.target.checked ? [...v.appliesTo, t] : v.appliesTo.filter((x) => x !== t))} />{t === "DISTRIBUTOR" ? "Distributors" : "Wholesalers"}</label>
  );
  return (
    <form className="space-y-4" data-testid="type-form" onSubmit={(e) => { e.preventDefault(); run(() => saveCertificateTypeAction({ ...v, description: v.description || null }), () => { if (!v.id) setV(EMPTY_TYPE); onDone?.(); }, "Saved — rules re-applied to every supplier"); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor={`t-name-${v.id ?? "new"}`}>Name</Label><Input id={`t-name-${v.id ?? "new"}`} value={v.name} onChange={(e) => set("name", e.target.value)} required /></div>
        <div className="space-y-1.5"><Label htmlFor={`t-desc-${v.id ?? "new"}`}>What suppliers should upload</Label><Input id={`t-desc-${v.id ?? "new"}`} value={v.description ?? ""} onChange={(e) => set("description", e.target.value)} /></div>
      </div>
      <div className="flex flex-wrap gap-4"><span className="text-sm font-medium">Applies to:</span>{sup("DISTRIBUTOR")}{sup("WHOLESALER")}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Multi id={`t-c-${v.id ?? "new"}`} label="Supplier countries" options={countries} value={v.countryIds} onChange={(x) => set("countryIds", x)} hint="None selected = every country." />
        <Multi id={`t-k-${v.id ?? "new"}`} label="Only for categories" options={categories} value={v.categoryIds} onChange={(x) => set("categoryIds", x)} hint="None = the whole supplier. With categories, only offers in them (and sub-categories) are paused." />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {box("required", "Required — pause when missing or expired", "Off = optional (shown in the supplier's checklist and score only).")}
        {box("hasExpiry", "Has an expiry date", "Reminders 30, 14 and 7 days before; expired after the date.")}
        {box("needsNumber", "Certificate number required")}
        {box("badgeEnabled", "Verified badge for customers", "Customers see the badge on the supplier and its products and can filter by it.")}
        {box("publicDownload", "Customers may download the certificate")}
        {box("isActive", "Active")}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor={`t-g-${v.id ?? "new"}`}>Grace days after expiry</Label><Input id={`t-g-${v.id ?? "new"}`} type="number" min={0} max={365} value={v.graceDays} onChange={(e) => set("graceDays", Number(e.target.value))} /></div>
        <div className="space-y-1.5"><Label htmlFor={`t-r-${v.id ?? "new"}`}>FIRINGI re-check every (months, empty = never)</Label><Input id={`t-r-${v.id ?? "new"}`} type="number" min={1} max={60} value={v.recheckMonths ?? ""} onChange={(e) => set("recheckMonths", e.target.value ? Number(e.target.value) : null)} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending} data-testid="save-type"><Spin on={pending} icon={Save} />{v.id ? "Save changes" : "Add certificate type"}</Button>
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

/** Admin company page: approve without the certificate code / POS invoice, with a required note. */
export function ApproveAnyway({ companyId, items }: { companyId: string; items: string[] }) {
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)} data-testid="approve-anyway">Approve anyway…</Button>;
  return (
    <div className="w-full space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="approve-anyway-form">
      <p>Approve without: <b>{items.join("; ")}</b>. Your note is kept on the account, in the status history and the audit log.</p>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why do you approve without it? (at least 10 characters)" />
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending || note.trim().length < 10} onClick={() => run(() => setCompanyStatusAction({ companyId, to: "APPROVED", reason: note, approveAnyway: true }))}><Check className="size-4" />Approve anyway</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      <Msg error={error} />
    </div>
  );
}
