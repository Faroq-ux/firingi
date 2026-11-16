"use client";
/** FIRINGI's launch controls (Phase 33, English): launch settings, legal entities, pilot invitations. */
import { useState } from "react";
import { Ban, Copy, Plus, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { createInviteAction, revokeInviteAction, saveLaunchSettingsAction, saveLegalEntityAction, sendInviteAction } from "@/server/actions/launch";
import type { LaunchSettings } from "@/server/launch/service";

export function LaunchSettingsForm({ settings, canManage }: { settings: LaunchSettings; canManage: boolean }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(settings);
  const text = (k: "termsUrl" | "privacyUrl" | "supportEmail", label: string, placeholder: string, hint: string) => (
    <div className="space-y-1">
      <Label htmlFor={`lc-${k}`}>{label}</Label>
      <Input id={`lc-${k}`} value={v[k]} disabled={!canManage} placeholder={placeholder} maxLength={500} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
  return (
    <form className="space-y-4" data-testid="launch-settings" onSubmit={(e) => { e.preventDefault(); run(() => saveLaunchSettingsAction(v), undefined, "Saved"); }}>
      <div className="grid gap-3 md:grid-cols-3">
        {text("termsUrl", "Terms of service (link)", "https://firingi.pt/terms", "Linked on the registration form, where every business accepts them.")}
        {text("privacyUrl", "Privacy policy (link)", "https://firingi.pt/privacy", "Linked on registration and sign-in (GDPR).")}
        {text("supportEmail", "Support e-mail", "support@firingi.pt", "Shown to businesses without an invitation and in the pilot banner.")}
      </div>
      <div className="space-y-2 rounded-xl border p-3">
        <label className="flex items-start gap-2 text-sm font-medium"><input type="checkbox" className="mt-1" checked={v.pilot} disabled={!canManage} onChange={(e) => setV({ ...v, pilot: e.target.checked })} data-testid="pilot-on" />
          <span>Pilot: registration by invitation only<span className="block text-xs font-normal text-muted-foreground">Businesses can only apply with an invitation link from FIRINGI. Drivers and existing accounts are not affected.</span></span></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={v.pilotBanner} disabled={!canManage || !v.pilot} onChange={(e) => setV({ ...v, pilotBanner: e.target.checked })} data-testid="pilot-banner" />
          <span>Show the pilot banner to customers and suppliers<span className="block text-xs text-muted-foreground">&ldquo;You are one of FIRINGI&rsquo;s first users — tell us what works and what doesn&rsquo;t&rdquo;, with a link to Support.</span></span></label>
      </div>
      {canManage && <div className="flex items-center gap-3"><Button type="submit" disabled={pending} data-testid="launch-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>}
    </form>
  );
}

type Entity = { id: string; countryCode: string; legalName: string; taxId: string; vatNumber: string; addressLine: string; postalCode: string; city: string; email: string; phone: string | null; invoices: number };
const EMPTY = { countryCode: "PT", legalName: "", taxId: "", vatNumber: "", addressLine: "", postalCode: "", city: "", email: "", phone: "" };

export function LegalEntityForm({ entity, countries, onDone }: { entity?: Entity; countries: { code: string; label: string }[]; onDone?: () => void }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(entity ? { ...entity, phone: entity.phone ?? "" } : EMPTY);
  const p = entity ? `le-${entity.id}` : "le-new";
  const locked = !!entity?.invoices;
  const f = (k: keyof typeof EMPTY, label: string, opts: { cls?: string; disabled?: boolean; placeholder?: string } = {}) => (
    <div className={`space-y-1 ${opts.cls ?? ""}`}>
      <Label htmlFor={`${p}-${k}`}>{label}</Label>
      <Input id={`${p}-${k}`} required value={v[k]} disabled={opts.disabled} placeholder={opts.placeholder} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    </div>
  );
  return (
    <form className="space-y-3" data-testid={entity ? "entity-form" : "entity-new"} onSubmit={(e) => {
      e.preventDefault();
      const { countryCode, legalName, taxId, vatNumber, addressLine, postalCode, city, email, phone } = v;
      run(() => saveLegalEntityAction({ id: entity?.id, countryCode, legalName, taxId, vatNumber, addressLine, postalCode, city, email, phone }), () => { if (!entity) setV(EMPTY); onDone?.(); }, "Saved");
    }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor={`${p}-countryCode`}>Country</Label>
          <select id={`${p}-countryCode`} className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={v.countryCode} disabled={locked} onChange={(e) => setV({ ...v, countryCode: e.target.value })}>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </div>
        {f("legalName", "Legal name", { cls: "lg:col-span-3", placeholder: "FIRINGI, Lda" })}
        {f("taxId", "Tax number (NIF)", { disabled: locked })}
        {f("vatNumber", "VAT number", { placeholder: "PT…" })}
        {f("email", "Invoicing e-mail", { placeholder: "invoices@firingi.pt" })}
        {f("phone", "Phone")}
        {f("addressLine", "Address", { cls: "sm:col-span-2" })}
        {f("postalCode", "Postal code")}
        {f("city", "City")}
      </div>
      {locked && <p className="text-xs text-muted-foreground">{entity!.invoices} invoices were issued with this tax number and country, so those two are locked.</p>}
      <div className="flex items-center gap-3"><Button type="submit" disabled={pending} data-testid={entity ? "entity-save" : "entity-add"}><Spin on={pending} icon={entity ? Save : Plus} /> {entity ? "Save" : "Add invoicing entity"}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function InviteForm({ countries }: { countries: { code: string; label: string; types: string[] }[] }) {
  const { pending, error, done, run } = useRun();
  const first = [...countries].sort((a, b) => b.types.length - a.types.length)[0];
  const [v, setV] = useState({ email: "", companyName: "", type: first?.types[0] ?? "CUSTOMER", countryCode: first?.code ?? "PT", days: "30", note: "" });
  const [link, setLink] = useState<string | null>(null);
  const types = countries.find((c) => c.code === v.countryCode)?.types ?? [];
  const submit = (send: boolean) =>
    run(() => createInviteAction({ ...v, type: v.type as "CUSTOMER" | "WHOLESALER" | "DISTRIBUTOR", days: Number(v.days), note: v.note || null, send }), (d) => { setLink((d as { link: string }).link); setV({ ...v, email: "", companyName: "", note: "" }); }, send ? "Invitation sent" : "Invitation created — copy the link below");
  return (
    <form className="space-y-3" data-testid="invite-form" onSubmit={(e) => { e.preventDefault(); submit(true); }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="space-y-1 lg:col-span-2"><Label htmlFor="inv-company">Business name</Label><Input id="inv-company" required minLength={2} value={v.companyName} onChange={(e) => setV({ ...v, companyName: e.target.value })} placeholder="Restaurante O Marinheiro" /></div>
        <div className="space-y-1 lg:col-span-2"><Label htmlFor="inv-email">E-mail</Label><Input id="inv-email" type="email" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="inv-country">Country</Label>
          <select id="inv-country" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={v.countryCode} onChange={(e) => { const c = countries.find((x) => x.code === e.target.value); setV({ ...v, countryCode: e.target.value, type: c?.types.includes(v.type) ? v.type : c?.types[0] ?? v.type }); }}>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select></div>
        <div className="space-y-1"><Label htmlFor="inv-type">Account type</Label>
          <select id="inv-type" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as typeof v.type })}>
            {types.map((t) => <option key={t} value={t}>{t === "CUSTOMER" ? "Customer" : t === "WHOLESALER" ? "Wholesaler" : "Distributor"}</option>)}
          </select></div>
        <div className="space-y-1"><Label htmlFor="inv-days">Valid (days)</Label><Input id="inv-days" type="number" min={1} max={180} value={v.days} onChange={(e) => setV({ ...v, days: e.target.value })} /></div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-5"><Label htmlFor="inv-note">Note (only FIRINGI sees it)</Label><Input id="inv-note" maxLength={300} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Met at the trade fair" /></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || !types.length} data-testid="invite-send"><Spin on={pending} icon={Send} /> Create & e-mail invitation</Button>
        <Button type="button" variant="outline" disabled={pending || !types.length} onClick={(e) => { const f = (e.currentTarget as HTMLButtonElement).form; if (f?.reportValidity()) submit(false); }} data-testid="invite-link-only">Create link only</Button>
        <Msg error={error} done={done} />
      </div>
      {link && <CopyLink link={link} testid="invite-new-link" />}
    </form>
  );
}

export function CopyLink({ link, testid }: { link: string; testid?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <span className="inline-flex max-w-full items-center gap-2" data-testid={testid}>
      <code className="truncate rounded bg-muted px-2 py-1 text-xs">{link}</code>
      <Button type="button" size="sm" variant="ghost" aria-label="Copy link" onClick={() => { void navigator.clipboard?.writeText(link); setOk(true); setTimeout(() => setOk(false), 1500); }}><Copy className="size-4" /> {ok ? "Copied" : "Copy"}</Button>
    </span>
  );
}

export function InviteActions({ id, link }: { id: string; link: string }) {
  const { pending, error, done, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <CopyLink link={link} />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => sendInviteAction({ id }), undefined, "Sent")} data-testid="invite-resend"><Send className="size-4" /> Send again</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => revokeInviteAction({ id }))} data-testid="invite-revoke"><Ban className="size-4" /> Revoke</Button>
      <Msg error={error} done={done} />
    </span>
  );
}
