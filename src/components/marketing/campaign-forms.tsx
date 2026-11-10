"use client";
/** Campaign builder and actions (FIRINGI back office, English). */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { CHANNEL_INFO, type CampaignChannel } from "@/lib/campaign-channels";
import { cancelCampaignAction, duplicateCampaignAction, previewAudienceAction, saveCampaignAction, sendCampaignAction } from "@/server/actions/marketing";

type Opt = { id: string; label: string };
type Ch = CampaignChannel;
const LANGS = [["en", "English (required)"], ["pt", "Português"], ["es", "Español"], ["fr", "Français"], ["de", "Deutsch"], ["it", "Italiano"]] as const;

export function CampaignBuilder({ defaults, segments, buyers, countries, promotions }: { defaults?: { channels?: Ch[] }; segments: Opt[]; buyers: Opt[]; countries: Opt[]; promotions: Opt[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<Ch[]>(defaults?.channels ?? ["EMAIL", "IN_APP"]);
  const [mode, setMode] = useState<"segment" | "types" | "companies">("types");
  const [types, setTypes] = useState<string[]>(["CUSTOMER"]);
  const [preview, setPreview] = useState<{ companies: number; people: number; reach: Record<string, number> } | null>(null);
  const [langs, setLangs] = useState<string[]>(["en", "pt"]);
  if (!open) return <Button onClick={() => setOpen(true)} data-testid="new-campaign">New campaign</Button>;

  const audienceOf = (fd: FormData) => mode === "segment" ? { segmentId: String(fd.get("segmentId") || "") || null }
    : mode === "companies" ? { companyIds: fd.getAll("companyIds").map(String) }
      : { types: types as ("CUSTOMER" | "WHOLESALER" | "DISTRIBUTOR")[], countryCodes: fd.getAll("countryCodes").map(String) };
  const textsOf = (fd: FormData, k: string) => Object.fromEntries(langs.map((l) => [l, String(fd.get(`${k}_${l}`) ?? "")]).filter(([, v]) => v.trim()));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <form className="space-y-4 rounded-xl border bg-card p-4" data-testid="campaign-form" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const payload = {
        name: String(fd.get("name")), channels, audience: audienceOf(fd), subject: textsOf(fd, "subject"), body: textsOf(fd, "body"), ctaLabel: textsOf(fd, "cta"),
        ctaPath: String(fd.get("ctaPath") || "") || null, promotionId: String(fd.get("promotionId") || "") || null, waTemplateName: String(fd.get("waTemplateName") || "") || null,
        scheduledAt: fd.get("scheduledAt") ? new Date(String(fd.get("scheduledAt"))).toISOString() : null,
      };
      start(async () => {
        const r = await saveCampaignAction(payload);
        if (r.ok) { setOpen(false); router.push(`/admin/marketing/campaigns/${r.data.id}`); } else setError(r.error);
      });
    }}>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="cname">Campaign name (internal)</Label><Input id="cname" name="name" required minLength={2} /></div>
        <fieldset className="space-y-1"><legend className="text-sm font-medium">Channels</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CHANNEL_INFO) as Ch[]).map((c) => { const I = CHANNEL_INFO[c].icon; return (
              <label key={c} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${channels.includes(c) ? "border-[color:var(--vivid-violet)] bg-[color-mix(in_oklch,var(--vivid-violet)_12%,transparent)]" : ""}`}>
                <input type="checkbox" className="sr-only" name={`ch_${c}`} checked={channels.includes(c)} onChange={() => { setChannels(toggle(channels, c)); setPreview(null); }} /><I className="size-4" aria-hidden />{CHANNEL_INFO[c].label}
              </label>); })}
          </div>
        </fieldset>
      </div>

      <fieldset className="space-y-2 rounded-lg border p-3"><legend className="px-1 text-sm font-medium">Audience</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {([["types", "Customers / suppliers by type and country"], ["segment", "A CRM segment"], ["companies", "Chosen companies"]] as const).map(([m, l]) => (
            <label key={m} className="flex items-center gap-1.5"><input type="radio" name="audienceMode" checked={mode === m} onChange={() => { setMode(m); setPreview(null); }} /> {l}</label>
          ))}
        </div>
        {mode === "types" && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-wrap gap-3 text-sm">{([["CUSTOMER", "Wholesale customers"], ["WHOLESALER", "Wholesalers"], ["DISTRIBUTOR", "Distributors"]] as const).map(([t, l]) => (
              <label key={t} className="flex items-center gap-1.5"><input type="checkbox" name={`type_${t}`} checked={types.includes(t)} onChange={() => { setTypes(toggle(types, t)); setPreview(null); }} /> {l}</label>))}</div>
            <div className="space-y-1"><Label>Countries (none = all)</Label><select name="countryCodes" multiple className="h-24 w-full rounded-md border bg-card p-1 text-sm">{countries.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
          </div>
        )}
        {mode === "segment" && <Select name="segmentId" required>{segments.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>}
        {mode === "companies" && <select name="companyIds" multiple required className="h-32 w-full rounded-md border bg-card p-1 text-sm">{buyers.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={(e) => {
            const fd = new FormData(e.currentTarget.form!);
            start(async () => { const r = await previewAudienceAction({ audience: audienceOf(fd), channels }); if (r.ok) setPreview(r.data); else setError(r.error); });
          }}>Preview audience</Button>
          {preview && <span className="text-sm" data-testid="audience-preview"><b>{preview.companies}</b> companies · <b>{preview.people}</b> people · reach {channels.map((c) => `${CHANNEL_INFO[c].label} ${preview.reach[c] ?? 0}`).join(", ")}</span>}
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border p-3"><legend className="px-1 text-sm font-medium">Message (each person gets their language; missing ones fall back to English)</legend>
        <div className="flex flex-wrap gap-3 text-sm">{LANGS.map(([l, n]) => <label key={l} className="flex items-center gap-1.5"><input type="checkbox" disabled={l === "en"} checked={langs.includes(l)} onChange={() => setLangs(toggle(langs, l))} /> {n}</label>)}</div>
        {langs.map((l) => (
          <div key={l} className="grid gap-2 md:grid-cols-[6rem_1fr]">
            <span className="pt-2 text-xs font-semibold uppercase text-muted-foreground">{l}</span>
            <div className="space-y-2">
              <Input name={`subject_${l}`} placeholder="Title / subject" required={l === "en"} aria-label={`Title (${l})`} />
              <textarea name={`body_${l}`} placeholder="Message" required={l === "en"} aria-label={`Message (${l})`} className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" />
              <Input name={`cta_${l}`} placeholder="Button text (optional, e.g. See the offer)" aria-label={`Button (${l})`} />
            </div>
          </div>
        ))}
      </fieldset>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1"><Label>Button opens</Label><Input name="ctaPath" defaultValue="/buy/catalogue/deals" /></div>
        <div className="space-y-1"><Label>Promote an offer / coupon</Label><Select name="promotionId"><option value="">—</option>{promotions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></div>
        <div className="space-y-1"><Label>Send at (empty = save as draft)</Label><Input name="scheduledAt" type="datetime-local" /></div>
        {channels.includes("WHATSAPP") && <div className="space-y-1"><Label>WhatsApp template (approved by Meta)</Label><Input name="waTemplateName" required placeholder="e.g. firingi_offer_v1" /></div>}
      </div>
      <p className="text-xs text-muted-foreground">Everyone gets offers & news unless they switched them off (per channel) or used the unsubscribe link. SMS and WhatsApp also need the person’s consent and mobile number; push needs a device.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={pending || !channels.length}>Save campaign</Button><Button type="button" variant="outline" onClick={() => setOpen(false)}>✕</Button></div>
    </form>
  );
}

export function CampaignActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const go = (fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, after?: (d: unknown) => void) => start(async () => {
    const r = await fn();
    if (r.ok) { setMsg(null); after?.(r.data); router.refresh(); } else setMsg(r.error ?? "Failed");
  });
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="campaign-actions">
      {(status === "DRAFT" || status === "SCHEDULED") && <Button disabled={pending} onClick={() => { if (confirm("Send this campaign now to its whole audience?")) go(() => sendCampaignAction({ id }), (d) => { const c = d as { sent: number; skipped: number; failed: number }; setMsg(`Sent ${c.sent}, skipped ${c.skipped}, failed ${c.failed}`); }); }}>Send now</Button>}
      {(status === "DRAFT" || status === "SCHEDULED") && <Button variant="outline" disabled={pending} onClick={() => go(() => cancelCampaignAction({ id }))}>Cancel</Button>}
      <Button variant="ghost" disabled={pending} onClick={() => go(() => duplicateCampaignAction({ id }), (d) => router.push(`/admin/marketing/campaigns/${(d as { id: string }).id}`))}>Duplicate</Button>
      {msg && <span className="text-sm" role="status">{msg}</span>}
    </div>
  );
}
