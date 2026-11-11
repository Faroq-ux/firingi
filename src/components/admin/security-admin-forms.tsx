"use client";
/** Back-office security forms (English, FIRINGI staff). */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/server/actions/_action";
import { createApiKeyAction, revokeApiKeyAction, setPaymentPolicyAction, updatePlatformSettingsAction } from "@/server/actions/security";
import { completeErasureAction, rejectErasureAction, resetTwoFactorAction, setSecurityPolicyAction, signOutEverywhereAction } from "@/server/actions/security";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = <T,>(fn: () => Promise<ActionResult<T>>, ok: (d: T) => string) =>
    start(async () => { const r = await fn(); setMsg(r.ok ? { ok: true, text: ok(r.data) } : { ok: false, text: r.error }); if (r.ok) router.refresh(); });
  return { pending, msg, run };
}

export function SecurityPolicyForm({ policy, canEdit }: { policy: { requireTwoFactorStaff: boolean; requireTwoFactorOwners: boolean; maxSessionHours: number }; canEdit: boolean }) {
  const { pending, msg, run } = useAct();
  const [p, setP] = useState(policy);
  return (
    <div className="space-y-3 text-sm" data-testid="security-policy">
      <fieldset disabled={!canEdit || pending} className="space-y-3">
        <label className="flex items-start gap-2 rounded-md border p-3"><input type="checkbox" name="requireTwoFactorStaff" className="mt-0.5" checked={p.requireTwoFactorStaff} onChange={(e) => setP({ ...p, requireTwoFactorStaff: e.target.checked })} />
          <span><b>Require two-factor login for FIRINGI staff</b><span className="block text-xs text-muted-foreground">Staff without it are sent to their Security page until they turn it on. Drivers (phone app) are not affected.</span></span></label>
        <label className="flex items-start gap-2 rounded-md border p-3"><input type="checkbox" name="requireTwoFactorOwners" className="mt-0.5" checked={p.requireTwoFactorOwners} onChange={(e) => setP({ ...p, requireTwoFactorOwners: e.target.checked })} />
          <span><b>Require two-factor login for company owners</b><span className="block text-xs text-muted-foreground">Owners of suppliers and customers (they manage users, prices and payments).</span></span></label>
        <label className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"><span><b>Maximum session length</b><span className="block text-xs text-muted-foreground">After this, everyone signs in again.</span></span>
          <span className="flex items-center gap-1"><Input type="number" name="maxSessionHours" min={1} max={168} className="w-24 text-right" value={p.maxSessionHours} onChange={(e) => setP({ ...p, maxSessionHours: Number(e.target.value) })} /> hours</span></label>
      </fieldset>
      {canEdit && <div className="flex items-center gap-3"><Button disabled={pending} onClick={() => run(() => setSecurityPolicyAction(p), () => "Saved")}>Save</Button>{msg && <span className={msg.ok ? "text-success" : "text-destructive"} role={msg.ok ? undefined : "alert"}>{msg.text}</span>}</div>}
    </div>
  );
}

export function UserSecurityActions({ userId, twoFactor, canReset }: { userId: string; twoFactor: boolean; canReset: boolean }) {
  const { pending, msg, run } = useAct();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => signOutEverywhereAction({ userId }), (n) => `Signed out ${n} session(s)`)}>Sign out everywhere</Button>
      {twoFactor && canReset && <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (confirm("Turn off this user's two-factor login? Use only when they lost their phone and backup codes.")) run(() => resetTwoFactorAction({ userId }), () => "Two-factor reset"); }}>Reset two-factor</Button>}
      {msg && <span className={`text-xs ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</span>}
    </span>
  );
}

export function ErasureActions({ id, blocked }: { id: string; blocked: boolean }) {
  const { pending, msg, run } = useAct();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="erasure-actions">
      <Input name="erasureNote" className="w-56" placeholder="Note to the person" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" disabled={pending || blocked} onClick={() => { if (confirm("Anonymise this account? This can't be undone.")) run(() => completeErasureAction({ id, note: note || null }), () => "Erased"); }}>Erase</Button>
      <Button size="sm" variant="outline" disabled={pending || !note.trim()} onClick={() => run(() => rejectErasureAction({ id, note }), () => "Rejected")}>Reject</Button>
      {msg && <span className={`text-xs ${msg.ok ? "text-success" : "text-destructive"}`} role={msg.ok ? undefined : "alert"}>{msg.text}</span>}
    </div>
  );
}

type Policy = {
  methods: Record<string, boolean>; mbWayPhone: string | null; overdueBlockDays: number | null; creditCheck: boolean;
  defaultTermsDays: { CUSTOMER: number; WHOLESALER: number }; defaultCreditLimit: { CUSTOMER: number | null; WHOLESALER: number | null }; supplierPayoutDays: number;
  online: { linkExpiryDays: number; reminderDaysBefore: number | null; reminderOnDue: boolean; reminderOverdueDays: number[] | string; directDebitNoticeDays: number; prepayCancelDays: number; newCustomersPayFirst: boolean };
};
const ONLINE_LABEL: Record<string, string> = { MB_WAY: "MB WAY (online)", MULTIBANCO: "Multibanco references", DIRECT_DEBIT: "SEPA direct debit", CARD: "Card online" };
const METHOD_LABEL: Record<string, string> = {
  BANK_TRANSFER: "Bank transfer (FIRINGI's IBAN)", MB_WAY: "MB WAY (to FIRINGI's number)", CASH_ON_DELIVERY: "Cash / card to the driver on delivery",
  MULTIBANCO: "Multibanco references", DIRECT_DEBIT: "SEPA direct debit", CARD: "Card online",
};

export function PaymentPolicyForm({ policy, needsProvider, canEdit, provider }: { policy: Policy; needsProvider: string[]; canEdit: boolean; provider: string | null }) {
  const { pending, msg, run } = useAct();
  const [p, setP] = useState(policy);
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <div className="space-y-4 text-sm" data-testid="payment-policy">
      <fieldset disabled={!canEdit || pending} className="space-y-4">
        <div className="rounded-md border p-3">
          <div className="mb-2 font-medium">Payment methods shown to buyers</div>
          <div className="grid gap-1 sm:grid-cols-2">
            {Object.keys(METHOD_LABEL).map((m) => (
              <label key={m} className="flex items-center gap-2">
                <input type="checkbox" name={`method-${m}`} disabled={needsProvider.includes(m)} checked={!!p.methods[m]} onChange={(e) => setP({ ...p, methods: { ...p.methods, [m]: e.target.checked } })} />
                {provider && ONLINE_LABEL[m] ? ONLINE_LABEL[m] : METHOD_LABEL[m]}{needsProvider.includes(m) && <span className="text-xs text-muted-foreground">(needs a payment provider)</span>}
              </label>
            ))}
          </div>
          {p.methods.MB_WAY && !provider && <label className="mt-2 flex items-center gap-2">MB WAY number <Input name="mbWayPhone" className="w-48" value={p.mbWayPhone ?? ""} onChange={(e) => setP({ ...p, mbWayPhone: e.target.value })} /></label>}
          <p className="mt-2 text-xs text-muted-foreground">{provider ? `Online methods go through ${provider} — customers pay in the portal or from a payment link (Finance › Online Payments).` : "No payment provider is configured: card, Multibanco and direct debit need one (server settings)."}</p>
        </div>
        <div className="rounded-md border p-3" data-testid="online-policy">
          <div className="mb-2 font-medium">Online payments, reminders &amp; direct debit</div>
          <label className="mb-1 flex flex-wrap items-center gap-2">Remind customers
            <Input type="number" name="reminderDaysBefore" min={1} max={30} className="w-16 text-right" placeholder="off" value={p.online.reminderDaysBefore ?? ""} onChange={(e) => setP({ ...p, online: { ...p.online, reminderDaysBefore: num(e.target.value) } })} /> days before the due date (empty = no)</label>
          <label className="mb-1 flex items-center gap-2"><input type="checkbox" checked={p.online.reminderOnDue} onChange={(e) => setP({ ...p, online: { ...p.online, reminderOnDue: e.target.checked } })} />…and on the due date</label>
          <label className="mb-1 flex flex-wrap items-center gap-2">…and when overdue by
            <Input name="reminderOverdueDays" className="w-32" value={Array.isArray(p.online.reminderOverdueDays) ? p.online.reminderOverdueDays.join(", ") : p.online.reminderOverdueDays} onChange={(e) => setP({ ...p, online: { ...p.online, reminderOverdueDays: e.target.value } })} /> days (each reminder carries a pay link)</label>
          <label className="mb-1 flex flex-wrap items-center gap-2">Payment links stay valid
            <Input type="number" name="linkExpiryDays" min={1} max={90} className="w-16 text-right" value={p.online.linkExpiryDays} onChange={(e) => setP({ ...p, online: { ...p.online, linkExpiryDays: Number(e.target.value) } })} /> days</label>
          <label className="mb-1 flex flex-wrap items-center gap-2">Direct debit: tell the customer
            <Input type="number" name="directDebitNoticeDays" min={1} max={14} className="w-16 text-right" value={p.online.directDebitNoticeDays} onChange={(e) => setP({ ...p, online: { ...p.online, directDebitNoticeDays: Number(e.target.value) } })} /> days before collecting</label>
          <label className="mb-1 flex flex-wrap items-center gap-2">Pay-before-shipping orders not paid within
            <Input type="number" name="prepayCancelDays" min={1} max={30} className="w-16 text-right" value={p.online.prepayCancelDays} onChange={(e) => setP({ ...p, online: { ...p.online, prepayCancelDays: Number(e.target.value) } })} /> days are cancelled</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={p.online.newCustomersPayFirst} onChange={(e) => setP({ ...p, online: { ...p.online, newCustomersPayFirst: e.target.checked } })} />Newly approved customers (restaurants, shops) pay before their orders ship</label>
          <p className="mt-1 text-xs text-muted-foreground">Per business: Customers › Credit &amp; Limits › Pay before shipping.</p>
        </div>
        <div className="rounded-md border p-3">
          <div className="mb-2 font-medium">Credit control at checkout</div>
          <label className="flex items-center gap-2"><input type="checkbox" name="creditCheck" checked={p.creditCheck} onChange={(e) => setP({ ...p, creditCheck: e.target.checked })} />Enforce each buyer&apos;s credit limit (open invoices + open orders + new order)</label>
          <label className="mt-2 flex flex-wrap items-center gap-2">Block new orders when an invoice is overdue for more than
            <Input type="number" name="overdueBlockDays" min={0} max={180} className="w-20 text-right" value={p.overdueBlockDays ?? ""} placeholder="off" onChange={(e) => setP({ ...p, overdueBlockDays: num(e.target.value) })} /> days (empty = never)</label>
        </div>
        <div className="rounded-md border p-3">
          <div className="mb-2 font-medium">Defaults for newly approved buyers</div>
          {(["CUSTOMER", "WHOLESALER"] as const).map((k) => (
            <div key={k} className="mb-1 flex flex-wrap items-center gap-2">
              <span className="w-28">{k === "CUSTOMER" ? "Customers" : "Wholesalers"}</span>
              pay within <Input type="number" name={`terms-${k}`} min={0} max={180} className="w-20 text-right" value={p.defaultTermsDays[k]} onChange={(e) => setP({ ...p, defaultTermsDays: { ...p.defaultTermsDays, [k]: Number(e.target.value) } })} /> days,
              credit limit <Input type="number" name={`limit-${k}`} min={0} className="w-28 text-right" placeholder="no limit" value={p.defaultCreditLimit[k] ?? ""} onChange={(e) => setP({ ...p, defaultCreditLimit: { ...p.defaultCreditLimit, [k]: num(e.target.value) } })} /> €
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Change a single buyer&apos;s terms and limit in Customers › Credit &amp; Terms or Payment Risk.</p>
        </div>
        <div className="rounded-md border p-3">
          <div className="mb-2 font-medium">Paying suppliers</div>
          <label className="flex flex-wrap items-center gap-2">When a supplier&apos;s invoice has no due date, pay it
            <Input type="number" name="supplierPayoutDays" min={0} max={180} className="w-20 text-right" value={p.supplierPayoutDays} onChange={(e) => setP({ ...p, supplierPayoutDays: Number(e.target.value) })} /> days after its date</label>
          <p className="text-xs text-muted-foreground">Finance sees what is due in Finance › Supplier Payouts Due and gets a daily reminder.</p>
        </div>
      </fieldset>
      {canEdit && <div className="flex items-center gap-3"><Button disabled={pending} onClick={() => run(() => setPaymentPolicyAction(p), () => "Saved")}>Save</Button>{msg && <span className={msg.ok ? "text-success" : "text-destructive"} role={msg.ok ? undefined : "alert"}>{msg.text}</span>}</div>}
    </div>
  );
}

export type SettingField = { path: string; label: string; help?: string; kind: "bool" | "number" | "text" | "textarea"; min?: number; max?: number; suffix?: string };

/** Generic editor for platform settings; `path` is "key" or "key.sub". */
export function PlatformSettingsForm({ fields, values, canEdit }: { fields: SettingField[]; values: Record<string, string | number | boolean | null>; canEdit: boolean }) {
  const { pending, msg, run } = useAct();
  const [v, setV] = useState(values);
  const save = () => {
    const patch: Record<string, unknown> = {};
    for (const f of fields) {
      const [a, b] = f.path.split(".");
      if (b) patch[a] = { ...((patch[a] as object) ?? {}), [b]: v[f.path] };
      else patch[a] = v[f.path];
    }
    run(() => updatePlatformSettingsAction({ patch }), () => "Saved");
  };
  return (
    <div className="space-y-3 text-sm" data-testid="platform-settings">
      <fieldset disabled={!canEdit || pending} className="space-y-3">
        {fields.map((f) => (
          <div key={f.path} className="rounded-md border p-3">
            {f.kind === "bool" ? (
              <label className="flex items-start gap-2"><input type="checkbox" name={f.path} className="mt-0.5" checked={!!v[f.path]} onChange={(e) => setV({ ...v, [f.path]: e.target.checked })} />
                <span><b>{f.label}</b>{f.help && <span className="block text-xs text-muted-foreground">{f.help}</span>}</span></label>
            ) : (
              <label className="grid gap-1"><span><b>{f.label}</b>{f.help && <span className="block text-xs text-muted-foreground">{f.help}</span>}</span>
                {f.kind === "textarea"
                  ? <textarea name={f.path} maxLength={300} className="min-h-16 w-full rounded-md border bg-card p-2" value={String(v[f.path] ?? "")} onChange={(e) => setV({ ...v, [f.path]: e.target.value })} />
                  : <span className="flex items-center gap-1"><Input name={f.path} type={f.kind === "number" ? "number" : "text"} min={f.min} max={f.max} className={f.kind === "number" ? "w-24 text-right" : "max-w-md"} value={String(v[f.path] ?? "")} onChange={(e) => setV({ ...v, [f.path]: f.kind === "number" ? Number(e.target.value) : e.target.value })} />{f.suffix}</span>}
              </label>
            )}
          </div>
        ))}
      </fieldset>
      {canEdit && <div className="flex items-center gap-3"><Button disabled={pending} onClick={save}>Save</Button>{msg && <span className={msg.ok ? "text-success" : "text-destructive"} role={msg.ok ? undefined : "alert"}>{msg.text}</span>}</div>}
    </div>
  );
}

type Target = { id: string; name: string; type: string; users: { id: string; label: string; owner: boolean }[] };
export function CreateApiKeyForm({ targets, scopes }: { targets: Target[]; scopes: { key: string; label: string }[] }) {
  const { pending, msg, run } = useAct();
  const [companyId, setCompanyId] = useState(targets[0]?.id ?? "");
  const company = targets.find((t) => t.id === companyId);
  const [userId, setUserId] = useState(company?.users.find((u) => u.owner)?.id ?? company?.users[0]?.id ?? "");
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string[]>([scopes[0]?.key ?? ""]);
  const [key, setKey] = useState<string | null>(null);
  if (key)
    return (
      <div className="space-y-2 text-sm" data-testid="new-api-key">
        <p className="font-medium text-success">Key created. Copy it now — it won&apos;t be shown again:</p>
        <code className="block break-all rounded bg-muted p-2 font-mono text-xs" data-testid="api-key-value">{key}</code>
        <Button size="sm" variant="outline" onClick={() => { setKey(null); setName(""); }}>Done</Button>
      </div>
    );
  return (
    <div className="space-y-3 text-sm" data-testid="create-api-key">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1">Company
          <select name="apiCompany" className="h-9 rounded-md border bg-card px-2" value={companyId} onChange={(e) => { setCompanyId(e.target.value); const c = targets.find((t) => t.id === e.target.value); setUserId(c?.users.find((u) => u.owner)?.id ?? c?.users[0]?.id ?? ""); }}>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.type.toLowerCase()})</option>)}
          </select>
        </label>
        <label className="grid gap-1">Acts as user
          <select name="apiUser" className="h-9 rounded-md border bg-card px-2" value={userId} onChange={(e) => setUserId(e.target.value)}>
            {company?.users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
        </label>
      </div>
      <label className="grid gap-1">Name<Input name="apiName" placeholder="e.g. POS integration" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="flex flex-wrap gap-4">{scopes.map((s) => (
        <label key={s.key} className="flex items-center gap-1.5"><input type="checkbox" name={`scope-${s.key}`} checked={chosen.includes(s.key)} onChange={(e) => setChosen(e.target.checked ? [...chosen, s.key] : chosen.filter((x) => x !== s.key))} />{s.label}</label>
      ))}</div>
      <div className="flex items-center gap-3">
        <Button disabled={pending || !userId} onClick={() => run(() => createApiKeyAction({ companyId, userId, name, scopes: chosen }), (d) => { setKey(d.key); return "Created"; })}>Create key</Button>
        {msg && !msg.ok && <span className="text-destructive" role="alert">{msg.text}</span>}
      </div>
    </div>
  );
}

export function RevokeApiKeyButton({ id }: { id: string }) {
  const { pending, msg, run } = useAct();
  return <span className="inline-flex items-center gap-1"><Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (confirm("Revoke this key? Systems using it stop working immediately.")) run(() => revokeApiKeyAction({ id }), () => "Revoked"); }}>Revoke</Button>{msg && <span className="text-xs">{msg.text}</span>}</span>;
}
