"use client";
/** CRM forms (FIRINGI back office, English). */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import type { ActionResult } from "@/server/actions/_action";
import {
  convertLeadAction, createDealAction, createLeadAction, createTaskAction, deleteSegmentAction, logActivityAction, moveDealAction, saveContactAction, saveSegmentAction,
  setAccountAction, setTaskStatusAction, updateLeadAction, updateTicketAction,
} from "@/server/actions/crm";

export type Opt = { id: string; label: string };
export type Target = { companyId?: string | null; leadId?: string | null; dealId?: string | null };

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const run = <T,>(fn: () => Promise<ActionResult<T>>, after?: (d: T) => string | void) =>
    start(async () => {
      setError(null); setMsg(null);
      const r = await fn();
      if (r.ok) { setMsg(after?.(r.data) || null); router.refresh(); } else setError(r.error);
    });
  return { pending, error, msg, run, router };
}
const Msg = ({ error, msg }: { error: string | null; msg: string | null }) =>
  error ? <p className="text-sm text-destructive" role="alert">{error}</p> : msg ? <p className="text-sm text-success" role="status">{msg}</p> : null;
const F = ({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) => (
  <label className={`space-y-1 text-sm ${className}`}><span className="block text-xs text-muted-foreground">{label}</span>{children}</label>
);
/** Group of toggle chips: a fieldset, so each chip keeps its own accessible name. */
const G = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <fieldset className="space-y-1 text-sm"><legend className="mb-1 block text-xs text-muted-foreground">{label}</legend>{children}</fieldset>
);
const today = () => new Date().toISOString().slice(0, 10);
/** Small disclosure: a button that opens the form. */
function Toggle({ label, children, open: initial = false }: { label: string; children: (close: () => void) => React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return open ? <div className="rounded-md border p-3">{children(() => setOpen(false))}</div> : <Button variant="outline" size="sm" onClick={() => setOpen(true)}>{label}</Button>;
}

// ── leads ───────────────────────────────────────────────────────────────────

export const LEAD_SOURCES = ["WEBSITE", "REFERRAL", "FIELD_VISIT", "PHONE", "EVENT", "SOCIAL", "OTHER"] as const;
const pretty = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export function NewLeadForm({ countries, team, defaultCountry }: { countries: Opt[]; team: Opt[]; defaultCountry: string }) {
  const { pending, error, msg, run, router } = useAct();
  const [v, setV] = useState({ companyName: "", contactName: "", email: "", phone: "", countryCode: defaultCountry, city: "", kind: "CUSTOMER", source: "FIELD_VISIT", ownerId: "", estimatedMonthlyNet: "", notes: "" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Toggle label="New lead">
      {(close) => (
        <div className="grid gap-2 sm:grid-cols-3" data-testid="lead-form">
          <F label="Business name"><Input name="companyName" value={v.companyName} onChange={set("companyName")} /></F>
          <F label="Contact person"><Input name="contactName" value={v.contactName} onChange={set("contactName")} /></F>
          <F label="Becomes a"><Select name="kind" value={v.kind} onChange={set("kind")}><option value="CUSTOMER">Customer</option><option value="WHOLESALER">Wholesaler</option><option value="DISTRIBUTOR">Distributor</option></Select></F>
          <F label="E-mail"><Input name="email" type="email" value={v.email} onChange={set("email")} /></F>
          <F label="Phone"><Input name="phone" value={v.phone} onChange={set("phone")} /></F>
          <F label="Source"><Select name="source" value={v.source} onChange={set("source")}>{LEAD_SOURCES.map((x) => <option key={x} value={x}>{pretty(x)}</option>)}</Select></F>
          <F label="Country"><Select name="countryCode" value={v.countryCode} onChange={set("countryCode")}>{countries.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></F>
          <F label="City"><Input name="city" value={v.city} onChange={set("city")} /></F>
          <F label="Expected monthly orders (€, excl. VAT)"><Input name="estimatedMonthlyNet" type="number" min={0} value={v.estimatedMonthlyNet} onChange={set("estimatedMonthlyNet")} /></F>
          <F label="Owner"><Select name="ownerId" value={v.ownerId} onChange={set("ownerId")}><option value="">Me</option>{team.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></F>
          <F label="Notes" className="sm:col-span-2"><Input name="notes" value={v.notes} onChange={set("notes")} /></F>
          <div className="flex items-end gap-2 sm:col-span-3">
            <Button disabled={pending} onClick={() => run(() => createLeadAction({ ...v, kind: v.kind as "CUSTOMER", source: v.source as "OTHER", ownerId: v.ownerId || null, estimatedMonthlyNet: v.estimatedMonthlyNet === "" ? null : Number(v.estimatedMonthlyNet) }), (r) => { router.push(`/admin/crm/leads/${r.id}`); })}>Create lead</Button>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Msg error={error} msg={msg} />
          </div>
        </div>
      )}
    </Toggle>
  );
}

export function LeadStatusForm({ id, status, ownerId, team }: { id: string; status: string; ownerId: string | null; team: Opt[] }) {
  const { pending, error, msg, run } = useAct();
  const [st, setSt] = useState(status);
  const [owner, setOwner] = useState(ownerId ?? "");
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="lead-status">
      <F label="Status"><Select name="leadStatus" value={st} onChange={(e) => setSt(e.target.value)}>{["NEW", "CONTACTED", "QUALIFIED", "LOST"].map((x) => <option key={x} value={x}>{pretty(x)}</option>)}</Select></F>
      {st === "LOST" && <F label="Why lost"><Input name="lostReason" value={reason} onChange={(e) => setReason(e.target.value)} /></F>}
      <F label="Owner"><Select name="leadOwner" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">—</option>{team.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></F>
      <Button size="sm" disabled={pending} onClick={() => run(() => updateLeadAction({ id, status: st as "NEW", ownerId: owner || null, lostReason: st === "LOST" ? reason : null }), () => "Saved")}>Save</Button>
      <Msg error={error} msg={msg} />
    </div>
  );
}

export function ConvertLeadForm({ leadId, companies }: { leadId: string; companies: Opt[] }) {
  const { pending, error, msg, run } = useAct();
  const [c, setC] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <F label="Registered as"><Select name="convertCompany" value={c} onChange={(e) => setC(e.target.value)}><option value="">Choose the company…</option>{companies.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></F>
      <Button size="sm" variant="outline" disabled={pending || !c} onClick={() => run(() => convertLeadAction({ leadId, companyId: c }), () => "Converted")}>Convert</Button>
      <Msg error={error} msg={msg} />
    </div>
  );
}

// ── accounts & contacts ─────────────────────────────────────────────────────

export function AccountForm({ companyId, ownerId, tier, tags, team }: { companyId: string; ownerId: string | null; tier: string | null; tags: string[]; team: Opt[] }) {
  const { pending, error, msg, run } = useAct();
  const [v, setV] = useState({ ownerId: ownerId ?? "", tier: tier ?? "", tags: tags.join(", ") });
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="account-form">
      <F label="Account manager"><Select name="accountOwner" value={v.ownerId} onChange={(e) => setV({ ...v, ownerId: e.target.value })}><option value="">—</option>{team.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></F>
      <F label="Tier"><Select name="tier" value={v.tier} onChange={(e) => setV({ ...v, tier: e.target.value })}><option value="">—</option><option>A</option><option>B</option><option>C</option></Select></F>
      <F label="Tags (comma separated)"><Input name="tags" className="w-64" value={v.tags} onChange={(e) => setV({ ...v, tags: e.target.value })} /></F>
      <Button size="sm" disabled={pending} onClick={() => run(() => setAccountAction({ companyId, ownerId: v.ownerId || null, tier: (v.tier || null) as "A" | null, tags: v.tags.split(",").map((x) => x.trim()).filter(Boolean) }), () => "Saved")}>Save</Button>
      <Msg error={error} msg={msg} />
    </div>
  );
}

export function ContactForm({ target, targets }: { target?: Target; targets?: { companies: Opt[]; leads: Opt[] } }) {
  const { pending, error, msg, run } = useAct();
  const [v, setV] = useState({ who: "", name: "", jobTitle: "", email: "", phone: "", isPrimary: false });
  const [c, l] = v.who.startsWith("l:") ? [null, v.who.slice(2)] : [v.who.slice(2) || null, null];
  return (
    <Toggle label="Add contact">
      {(close) => (
        <div className="grid gap-2 sm:grid-cols-3" data-testid="contact-form">
          {!target && targets && (
            <F label="Company or lead" className="sm:col-span-3">
              <Select name="contactWho" value={v.who} onChange={(e) => setV({ ...v, who: e.target.value })}>
                <option value="">Choose…</option>
                <optgroup label="Companies">{targets.companies.map((x) => <option key={x.id} value={`c:${x.id}`}>{x.label}</option>)}</optgroup>
                <optgroup label="Leads">{targets.leads.map((x) => <option key={x.id} value={`l:${x.id}`}>{x.label}</option>)}</optgroup>
              </Select>
            </F>
          )}
          <F label="Name"><Input name="contactName" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></F>
          <F label="Job title"><Input name="contactJob" value={v.jobTitle} onChange={(e) => setV({ ...v, jobTitle: e.target.value })} /></F>
          <F label="Phone"><Input name="contactPhone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></F>
          <F label="E-mail"><Input name="contactEmail" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></F>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={v.isPrimary} onChange={(e) => setV({ ...v, isPrimary: e.target.checked })} /> Main contact</label>
          <div className="flex items-end gap-2">
            <Button size="sm" disabled={pending} onClick={() => run(() => saveContactAction({ companyId: target?.companyId ?? c, leadId: target?.leadId ?? l, name: v.name, jobTitle: v.jobTitle || null, email: v.email || null, phone: v.phone || null, isPrimary: v.isPrimary }), () => { close(); })}>Save</Button>
            <Button size="sm" variant="ghost" onClick={close}>Cancel</Button>
          </div>
          <Msg error={error} msg={msg} />
        </div>
      )}
    </Toggle>
  );
}

// ── deals ───────────────────────────────────────────────────────────────────

export const STAGES = ["PROSPECTING", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const;

export function DealForm({ target, targets, team }: { target?: Target; targets?: { companies: Opt[]; leads: Opt[] }; team: Opt[] }) {
  const { pending, error, msg, run } = useAct();
  const [v, setV] = useState({ who: "", title: "", valueNet: "", expectedCloseAt: "", ownerId: "" });
  const [c, l] = v.who.startsWith("l:") ? [null, v.who.slice(2)] : [v.who.slice(2) || null, null];
  return (
    <Toggle label="New deal">
      {(close) => (
        <div className="grid gap-2 sm:grid-cols-3" data-testid="deal-form">
          {!target && targets && (
            <F label="Company or lead" className="sm:col-span-3">
              <Select name="dealWho" value={v.who} onChange={(e) => setV({ ...v, who: e.target.value })}>
                <option value="">Choose…</option>
                <optgroup label="Companies">{targets.companies.map((x) => <option key={x.id} value={`c:${x.id}`}>{x.label}</option>)}</optgroup>
                <optgroup label="Leads">{targets.leads.map((x) => <option key={x.id} value={`l:${x.id}`}>{x.label}</option>)}</optgroup>
              </Select>
            </F>
          )}
          <F label="Title"><Input name="dealTitle" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></F>
          <F label="Expected monthly value (€, excl. VAT)"><Input name="dealValue" type="number" min={0} value={v.valueNet} onChange={(e) => setV({ ...v, valueNet: e.target.value })} /></F>
          <F label="Expected close"><Input name="dealClose" type="date" value={v.expectedCloseAt} onChange={(e) => setV({ ...v, expectedCloseAt: e.target.value })} /></F>
          <F label="Owner"><Select name="dealOwner" value={v.ownerId} onChange={(e) => setV({ ...v, ownerId: e.target.value })}><option value="">Me</option>{team.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></F>
          <div className="flex items-end gap-2">
            <Button size="sm" disabled={pending} onClick={() => run(() => createDealAction({ title: v.title, companyId: target?.companyId ?? c, leadId: target?.leadId ?? l, valueNet: Number(v.valueNet || 0), expectedCloseAt: v.expectedCloseAt || null, ownerId: v.ownerId || null }), () => { close(); })}>Create deal</Button>
            <Button size="sm" variant="ghost" onClick={close}>Cancel</Button>
          </div>
          <Msg error={error} msg={msg} />
        </div>
      )}
    </Toggle>
  );
}

export function DealStageForm({ id, stage }: { id: string; stage: string }) {
  const { pending, error, run } = useAct();
  const [st, setSt] = useState(stage);
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="deal-stage">
      <Select aria-label="Stage" name="dealStage" className="h-8 text-xs" value={st} onChange={(e) => setSt(e.target.value)}>{STAGES.map((x) => <option key={x} value={x}>{pretty(x)}</option>)}</Select>
      {st === "LOST" && <Input aria-label="Why lost" placeholder="Why lost" className="h-8 w-32 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} />}
      {st !== stage && <Button size="sm" className="h-8" disabled={pending} onClick={() => run(() => moveDealAction({ id, stage: st as "WON", lostReason: st === "LOST" ? reason : null }))}>Move</Button>}
      {error && <span className="text-xs text-destructive" role="alert">{error}</span>}
    </div>
  );
}

// ── activities, tasks ───────────────────────────────────────────────────────

const ACT_KINDS = ["CALL", "EMAIL", "WHATSAPP", "MEETING", "VISIT", "NOTE"] as const;

export function ActivityForm({ target, targets, kind, label = "Log activity" }: { target?: Target; targets?: { companies: Opt[]; leads: Opt[] }; kind?: (typeof ACT_KINDS)[number]; label?: string }) {
  const { pending, error, msg, run } = useAct();
  const [v, setV] = useState({ who: "", kind: kind ?? "CALL", subject: "", body: "", outbound: true, at: "" });
  const [c, l] = v.who.startsWith("l:") ? [null, v.who.slice(2)] : [v.who.slice(2) || null, null];
  const note = v.kind === "NOTE";
  return (
    <Toggle label={label}>
      {(close) => (
        <div className="grid gap-2 sm:grid-cols-4" data-testid="activity-form">
          {!target && targets && (
            <F label="Company or lead" className="sm:col-span-4">
              <Select name="activityWho" value={v.who} onChange={(e) => setV({ ...v, who: e.target.value })}>
                <option value="">Choose…</option>
                <optgroup label="Companies">{targets.companies.map((x) => <option key={x.id} value={`c:${x.id}`}>{x.label}</option>)}</optgroup>
                <optgroup label="Leads">{targets.leads.map((x) => <option key={x.id} value={`l:${x.id}`}>{x.label}</option>)}</optgroup>
              </Select>
            </F>
          )}
          {!kind && <F label="Type"><Select name="activityKind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as "CALL" })}>{ACT_KINDS.map((x) => <option key={x} value={x}>{x === "WHATSAPP" ? "WhatsApp" : x === "EMAIL" ? "E-mail" : pretty(x)}</option>)}</Select></F>}
          <F label={note ? "Note" : "Subject"} className={kind ? "sm:col-span-2" : ""}><Input name="activitySubject" value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} /></F>
          {!note && <F label="When (blank = now)"><Input name="activityAt" type="datetime-local" value={v.at} onChange={(e) => setV({ ...v, at: e.target.value })} /></F>}
          {!note && <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={!v.outbound} onChange={(e) => setV({ ...v, outbound: !e.target.checked })} /> They contacted us</label>}
          <F label="Details" className="sm:col-span-4"><textarea name="activityBody" className="min-h-16 w-full rounded-md border bg-background p-2 text-sm" value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></F>
          <div className="flex items-end gap-2">
            <Button size="sm" disabled={pending} onClick={() => run(() => logActivityAction({ kind: v.kind, subject: v.subject, body: v.body || null, at: v.at || null, outbound: v.outbound, companyId: target?.companyId ?? c, leadId: target?.leadId ?? l, dealId: target?.dealId ?? null }), () => { close(); })}>Save</Button>
            <Button size="sm" variant="ghost" onClick={close}>Cancel</Button>
          </div>
          <Msg error={error} msg={msg} />
        </div>
      )}
    </Toggle>
  );
}

export function TaskForm({ target, targets, team, kind = "TASK", label }: { target?: Target; targets?: { companies: Opt[]; leads: Opt[] }; team: Opt[]; kind?: "TASK" | "FOLLOW_UP"; label?: string }) {
  const { pending, error, msg, run } = useAct();
  const [v, setV] = useState({ who: "", title: "", dueAt: today(), assigneeId: "", notes: "" });
  const [c, l] = v.who.startsWith("l:") ? [null, v.who.slice(2)] : [v.who.slice(2) || null, null];
  return (
    <Toggle label={label ?? (kind === "FOLLOW_UP" ? "Add follow-up" : "Add task")}>
      {(close) => (
        <div className="grid gap-2 sm:grid-cols-4" data-testid="task-form">
          {!target && targets && (
            <F label={kind === "FOLLOW_UP" ? "Company or lead" : "About (optional)"} className="sm:col-span-4">
              <Select name="taskWho" value={v.who} onChange={(e) => setV({ ...v, who: e.target.value })}>
                <option value="">{kind === "FOLLOW_UP" ? "Choose…" : "—"}</option>
                <optgroup label="Companies">{targets.companies.map((x) => <option key={x.id} value={`c:${x.id}`}>{x.label}</option>)}</optgroup>
                <optgroup label="Leads">{targets.leads.map((x) => <option key={x.id} value={`l:${x.id}`}>{x.label}</option>)}</optgroup>
              </Select>
            </F>
          )}
          <F label="What" className="sm:col-span-2"><Input name="taskTitle" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></F>
          <F label="Due"><Input name="taskDue" type="date" value={v.dueAt} onChange={(e) => setV({ ...v, dueAt: e.target.value })} /></F>
          <F label="For"><Select name="taskAssignee" value={v.assigneeId} onChange={(e) => setV({ ...v, assigneeId: e.target.value })}><option value="">Me</option>{team.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></F>
          <div className="flex items-end gap-2 sm:col-span-4">
            <Button size="sm" disabled={pending} onClick={() => run(() => createTaskAction({ kind, title: v.title, dueAt: v.dueAt, assigneeId: v.assigneeId || null, notes: v.notes || null, companyId: target?.companyId ?? c, leadId: target?.leadId ?? l, dealId: target?.dealId ?? null }), () => { close(); })}>Save</Button>
            <Button size="sm" variant="ghost" onClick={close}>Cancel</Button>
            <Msg error={error} msg={msg} />
          </div>
        </div>
      )}
    </Toggle>
  );
}

export function TaskDoneButton({ id, done }: { id: string; done: boolean }) {
  const { pending, error, run } = useAct();
  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" variant={done ? "ghost" : "outline"} className="h-7 text-xs" disabled={pending} onClick={() => run(() => setTaskStatusAction({ id, status: done ? "OPEN" : "DONE" }))}>{done ? "Reopen" : "Done"}</Button>
      {error && <span className="text-xs text-destructive" role="alert">{error}</span>}
    </span>
  );
}

// ── segments ────────────────────────────────────────────────────────────────

export type SegmentRulesValue = { types: string[]; countryCodes: string[]; tags: string; tiers: string[]; ownerId: string; statuses: string[]; minSpend90: string; maxSpend90: string };
const STATUSES = ["ACTIVE", "NEW", "AT_RISK", "DORMANT", "NEVER_ORDERED"];

export function SegmentForm({ id, name, description, rules, countries, team, onSaved }: { id?: string; name?: string; description?: string | null; rules?: Partial<SegmentRulesValue>; countries: Opt[]; team: Opt[]; onSaved?: string }) {
  const { pending, error, msg, run, router } = useAct();
  const [n, setN] = useState(name ?? "");
  const [d, setD] = useState(description ?? "");
  const [r, setR] = useState<SegmentRulesValue>({ types: [], countryCodes: [], tags: "", tiers: [], ownerId: "", statuses: [], minSpend90: "", maxSpend90: "", ...rules });
  const toggle = (k: "types" | "countryCodes" | "tiers" | "statuses", v: string) => setR({ ...r, [k]: r[k].includes(v) ? r[k].filter((x) => x !== v) : [...r[k], v] });
  const chips = (k: "types" | "countryCodes" | "tiers" | "statuses", opts: Opt[]) => (
    <div className="flex flex-wrap gap-1">{opts.map((o) => (
      <button key={o.id} type="button" onClick={() => toggle(k, o.id)} className={`rounded-full border px-2 py-0.5 text-xs ${r[k].includes(o.id) ? "bg-primary text-primary-foreground" : ""}`} aria-pressed={r[k].includes(o.id)}>{o.label}</button>
    ))}</div>
  );
  const payload = { types: r.types, countryCodes: r.countryCodes, tags: r.tags.split(",").map((x) => x.trim()).filter(Boolean), tiers: r.tiers, ownerId: r.ownerId || null, statuses: r.statuses, minSpend90: r.minSpend90 === "" ? null : Number(r.minSpend90), maxSpend90: r.maxSpend90 === "" ? null : Number(r.maxSpend90) };
  return (
    <div className="space-y-3 text-sm" data-testid="segment-form">
      <div className="grid gap-2 sm:grid-cols-2">
        <F label="Name"><Input name="segmentName" value={n} onChange={(e) => setN(e.target.value)} /></F>
        <F label="Description"><Input name="segmentDescription" value={d} onChange={(e) => setD(e.target.value)} /></F>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <G label="Buyer type">{chips("types", [{ id: "CUSTOMER", label: "Customers" }, { id: "WHOLESALER", label: "Wholesalers" }])}</G>
        <G label="Activity">{chips("statuses", STATUSES.map((s) => ({ id: s, label: pretty(s) })))}</G>
        <G label="Country">{chips("countryCodes", countries)}</G>
        <G label="Tier">{chips("tiers", ["A", "B", "C"].map((t) => ({ id: t, label: t })))}</G>
        <F label="Tags (any of, comma separated)"><Input name="segmentTags" value={r.tags} onChange={(e) => setR({ ...r, tags: e.target.value })} /></F>
        <F label="Account manager"><Select name="segmentOwner" value={r.ownerId} onChange={(e) => setR({ ...r, ownerId: e.target.value })}><option value="">Anyone</option>{team.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></F>
        <F label="Spend last 90 days from (€)"><Input name="minSpend90" type="number" min={0} value={r.minSpend90} onChange={(e) => setR({ ...r, minSpend90: e.target.value })} /></F>
        <F label="… up to (€)"><Input name="maxSpend90" type="number" min={0} value={r.maxSpend90} onChange={(e) => setR({ ...r, maxSpend90: e.target.value })} /></F>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending} onClick={() => run(() => saveSegmentAction({ id: id ?? null, name: n, description: d || null, rules: payload }), (x) => { router.push(onSaved ?? `/admin/crm/segments?id=${x.id}`); return "Saved"; })}>Save segment</Button>
        {id && <Button variant="ghost" disabled={pending} onClick={() => { if (confirm("Delete this segment?")) run(() => deleteSegmentAction({ id }), () => { router.push("/admin/crm/segments"); }); }}>Delete</Button>}
        <Msg error={error} msg={msg} />
      </div>
    </div>
  );
}

// ── support (staff side) ────────────────────────────────────────────────────

export function TicketAdminForm({ id, assigneeId, priority, status, team }: { id: string; assigneeId: string | null; priority: string; status: string; team: Opt[] }) {
  const { pending, error, msg, run } = useAct();
  const [v, setV] = useState({ assigneeId: assigneeId ?? "", priority, status });
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="ticket-admin">
      <F label="Assigned to"><Select name="ticketAssignee" value={v.assigneeId} onChange={(e) => setV({ ...v, assigneeId: e.target.value })}><option value="">Nobody</option>{team.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></F>
      <F label="Priority"><Select name="ticketPriority" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>{["LOW", "NORMAL", "HIGH", "URGENT"].map((x) => <option key={x} value={x}>{pretty(x)}</option>)}</Select></F>
      <F label="Status"><Select name="ticketStatus" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>{[["OPEN", "Open"], ["PENDING_CUSTOMER", "Waiting for the company"], ["RESOLVED", "Resolved"], ["CLOSED", "Closed"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></F>
      <Button size="sm" disabled={pending} onClick={() => run(() => updateTicketAction({ id, assigneeId: v.assigneeId || null, priority: v.priority as "LOW", status: v.status as "OPEN" }), () => "Saved")}>Save</Button>
      <Msg error={error} msg={msg} />
    </div>
  );
}

