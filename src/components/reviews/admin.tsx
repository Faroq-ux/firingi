"use client";
/** FIRINGI's Reviews settings (Phase 53, English): every switch, the filter's words, per-business switches. */
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { saveReviewSettingsAction, setReviewSwitchAction } from "@/server/actions/reviews";
import { findTenderBusinessAction } from "@/server/actions/tenders";
import type { ReviewSettings } from "@/lib/reviews";

export function ReviewSwitch({ companyId, state: initial }: { companyId: string; state: "DEFAULT" | "ON" | "OFF" }) {
  const { pending, error, run } = useRun();
  const [state, setState] = useState(initial);
  return (
    <span className="inline-flex items-center gap-1">
      <Select aria-label="Reviews for this business" value={state} disabled={pending} className="h-8 w-40" data-testid="review-switch"
        onChange={(e) => { const v = e.target.value as typeof state; const prev = state; setState(v); run(async () => { const r = await setReviewSwitchAction({ companyId, state: v }); if (!r.ok) setState(prev); return r; }); }}>
        <option value="DEFAULT">Default (by type)</option><option value="ON">Always on</option><option value="OFF">Off</option>
      </Select>
      <Msg error={error} />
    </span>
  );
}

export function FindReviewBusiness() {
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ id: string; name: string; type: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => { const r = await findTenderBusinessAction({ q }); if (r.ok) setHits(r.data as typeof hits); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-2">
      <Input placeholder="Find a business by name or NIF…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="review-find" />
      {hits.length > 0 && <ul className="divide-y rounded-lg border" data-testid="review-find-hits">{hits.map((h) => <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"><span className="min-w-0 flex-1 break-words">{h.name} <span className="text-xs text-muted-foreground">· {h.type.toLowerCase()}</span></span><ReviewSwitch companyId={h.id} state="DEFAULT" /></li>)}</ul>}
    </div>
  );
}

function Box({ label, checked, onChange, hint, testid }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; testid?: string }) {
  return <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>;
}
function Num({ label, value, onChange, hint, testid }: { label: string; value: number; onChange: (v: number) => void; hint?: string; testid?: string }) {
  return <div><Label className="text-xs">{label}</Label><Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={testid} />{hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}</div>;
}
const PARTS: Record<string, [string, string]> = {
  reviews: ["Reviews", "Stars and text from businesses that received the product."],
  details: ["Detail scores", "Quality, value for money, packaging, freshness / shelf life."],
  photos: ["Photos", "Up to the number below per review."],
  helpful: ["Helpful votes", "Most helpful reviews first."],
  questions: ["Questions & answers", "Buyers ask; the supplier and FIRINGI answer (official)."],
  buyerAnswers: ["Buyers answer too", "Only businesses that received the product."],
  replies: ["Supplier replies", "One public reply per review."],
  insights: ["Supplier insights", "Ratings per product, trend, common complaints."],
  reminders: ["Review reminders", "E-mail / push a few days after delivery, once per product."],
  searchStars: ["Stars in search", "Stars on cards, the “4★ and up” filter and sort by rating."],
  aiSummary: ["AI summary", "Needs the Anthropic key (AI Centre); off without it."],
};
const lines = (a: string[]) => a.join("\n");
const unlines = (s: string) => s.split(/\n|,/).map((x) => x.trim()).filter(Boolean);

export function ReviewSettingsForm({ initial }: { initial: ReviewSettings }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const [comp, setComp] = useState(lines(initial.filter.competitors)), [words, setWords] = useState(lines(initial.filter.words));
  const set = <K extends keyof ReviewSettings>(k: K, v: ReviewSettings[K]) => setS({ ...s, [k]: v });
  return (
    <form className="space-y-6" data-testid="rs-form" onSubmit={(e) => { e.preventDefault(); run(() => saveReviewSettingsAction({ ...s, filter: { ...s.filter, competitors: unlines(comp), words: unlines(words) } }), undefined, "Saved."); }}>
      <Box label="Reviews & questions are on" hint="Off: nothing is shown or asked; reviews already written are kept." checked={s.enabled} onChange={(v) => set("enabled", v)} testid="rs-enabled" />
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-2"><h3 className="text-sm font-semibold">Who may write</h3>
          <Box label="Customers (restaurants, shops)" checked={s.buyers.CUSTOMER} onChange={(v) => set("buyers", { ...s.buyers, CUSTOMER: v })} testid="rs-buyer-CUSTOMER" />
          <Box label="Wholesalers (buying from distributors)" checked={s.buyers.WHOLESALER} onChange={(v) => set("buyers", { ...s.buyers, WHOLESALER: v })} testid="rs-buyer-WHOLESALER" />
        </div>
        <div className="space-y-2"><h3 className="text-sm font-semibold">Whose products show reviews</h3>
          <Box label="Wholesalers' products" checked={s.sellers.WHOLESALER} onChange={(v) => set("sellers", { ...s.sellers, WHOLESALER: v })} testid="rs-seller-WHOLESALER" />
          <Box label="Distributors' products" checked={s.sellers.DISTRIBUTOR} onChange={(v) => set("sellers", { ...s.sellers, DISTRIBUTOR: v })} testid="rs-seller-DISTRIBUTOR" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Photos per review (0–3)" value={s.maxPhotos} onChange={(v) => set("maxPhotos", v)} />
          <Num label="Longest text (characters)" value={s.maxChars} onChange={(v) => set("maxChars", v)} />
          <Num label="Days to edit a review" value={s.editDays} onChange={(v) => set("editDays", v)} hint="0 = always" />
          <Num label="Remind after delivery (days)" value={s.reminder.afterDays} onChange={(v) => set("reminder", { afterDays: v })} />
          <Num label="Reviews before an AI summary" value={s.aiMinReviews} onChange={(v) => set("aiMinReviews", v)} testid="rs-ai-min" />
        </div>
      </section>
      <section className="space-y-2"><h3 className="text-sm font-semibold">Parts</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(PARTS).map(([k, [label, hint]]) => <Box key={k} label={label} hint={hint} checked={s.parts[k as keyof typeof s.parts]} onChange={(v) => set("parts", { ...s.parts, [k]: v })} testid={`rs-part-${k}`} />)}</div>
      </section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Automatic filter</h3>
        <p className="text-xs text-muted-foreground">Posts publish at once. Those the filter catches wait in <b>Reviews › Moderation</b> until FIRINGI publishes or hides them.</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Box label="Contact details" hint="E-mail, phone numbers, WhatsApp / social handles." checked={s.filter.contacts} onChange={(v) => set("filter", { ...s.filter, contacts: v })} testid="rs-f-contacts" />
          <Box label="Links" hint="Web addresses." checked={s.filter.links} onChange={(v) => set("filter", { ...s.filter, links: v })} testid="rs-f-links" />
          <Box label="Insults" hint="A built-in list in the main EU languages." checked={s.filter.insults} onChange={(v) => set("filter", { ...s.filter, insults: v })} testid="rs-f-insults" />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div><Label className="text-xs" htmlFor="rs-competitors">Competitor names (one per line)</Label><textarea id="rs-competitors" className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={comp} onChange={(e) => setComp(e.target.value)} data-testid="rs-competitors" /></div>
          <div><Label className="text-xs" htmlFor="rs-words">Other blocked words (one per line)</Label><textarea id="rs-words" className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={words} onChange={(e) => setWords(e.target.value)} data-testid="rs-words" /></div>
          <Num label="Reports that hold a post" value={s.autoHoldReports} onChange={(v) => set("autoHoldReports", v)} hint="It waits for FIRINGI after this many businesses report it. 0 = never hold automatically." testid="rs-hold-reports" />
        </div>
      </section>
      <div className="flex items-center gap-3"><Button type="submit" disabled={pending} data-testid="rs-save"><Spin on={pending} icon={Check} /> Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}
