"use client";
/** Phase 14 forms: costs, margin rules, KPI targets, rating moderation (English back office) and ratings (translated). */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { COST_LABELS } from "@/lib/cost-labels";
import type { ActionResult } from "@/server/actions/_action";
import { deleteCostAction, moderateRatingAction, rateOrderAction, removeMarginRuleAction, replyRatingAction, saveCostAction, saveMarginRuleAction, setKpiTargetAction } from "@/server/actions/profit";

type Opt = { id: string; label: string };
function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const run = <T,>(fn: () => Promise<ActionResult<T>>, ok?: string, refresh = true) => start(async () => {
    setError(null); setMsg(null);
    const r = await fn();
    if (r.ok) { setMsg(ok ?? null); if (refresh) router.refresh(); } else setError(r.error);
  });
  return { pending, error, msg, run };
}
const F = ({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) => (
  <label className={`space-y-1 text-sm ${className}`}><span className="block text-xs text-muted-foreground">{label}</span>{children}</label>
);
const Msg = ({ error, msg }: { error: string | null; msg: string | null }) =>
  error ? <span className="text-sm text-destructive" role="alert">{error}</span> : msg ? <span className="text-sm text-success" role="status">{msg}</span> : null;
const today = () => new Date().toISOString().slice(0, 10);


export function CostForm({ countries }: { countries: Opt[] }) {
  const { pending, error, msg, run } = useAct();
  const [v, setV] = useState({ date: today(), monthly: false, endDate: "", category: "FLEET", description: "", amountNet: "", vatAmount: "", countryCode: "", paid: true });
  return (
    <div className="grid gap-2 sm:grid-cols-4" data-testid="cost-form">
      <F label="Category"><Select name="costCategory" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{Object.entries(COST_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></F>
      <F label="Description" className="sm:col-span-2"><Input name="costDescription" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></F>
      <F label="Market"><Select name="costCountry" value={v.countryCode} onChange={(e) => setV({ ...v, countryCode: e.target.value })}><option value="">Whole company</option>{countries.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></F>
      <F label="Amount (€, excl. VAT)"><Input name="costAmount" type="number" min={0} step="0.01" value={v.amountNet} onChange={(e) => setV({ ...v, amountNet: e.target.value })} /></F>
      <F label="VAT (€)"><Input name="costVat" type="number" min={0} step="0.01" value={v.vatAmount} onChange={(e) => setV({ ...v, vatAmount: e.target.value })} /></F>
      <F label={v.monthly ? "From" : "Date"}><Input name="costDate" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></F>
      {v.monthly ? <F label="Until (blank = running)"><Input name="costEnd" type="date" value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} /></F> : <span />}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="costMonthly" checked={v.monthly} onChange={(e) => setV({ ...v, monthly: e.target.checked })} /> Every month</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.paid} onChange={(e) => setV({ ...v, paid: e.target.checked })} /> Paid (counts in cash flow)</label>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Button disabled={pending} onClick={() => run(() => saveCostAction({ ...v, endDate: v.monthly && v.endDate ? v.endDate : null, category: v.category as "FLEET", amountNet: Number(v.amountNet), vatAmount: Number(v.vatAmount || 0), countryCode: v.countryCode || null }), "Recorded")}>Record cost</Button>
        <Msg error={error} msg={msg} />
      </div>
    </div>
  );
}

export function DeleteCost({ id }: { id: string }) {
  const { pending, error, run } = useAct();
  return <span><Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (confirm("Delete this cost?")) run(() => deleteCostAction({ id })); }}>Delete</Button>{error && <span className="text-xs text-destructive">{error}</span>}</span>;
}

export function MarginRuleForm({ countries, categories, vendors }: { countries: Opt[]; categories: Opt[]; vendors: Opt[] }) {
  const { pending, error, msg, run } = useAct();
  const [v, setV] = useState({ scope: "GLOBAL", target: "", min: "", goal: "", note: "" });
  const opts = v.scope === "COUNTRY" ? countries : v.scope === "CATEGORY" ? categories : v.scope === "VENDOR" ? vendors : [];
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="margin-form">
      <F label="Applies to"><Select name="marginScope" value={v.scope} onChange={(e) => setV({ ...v, scope: e.target.value, target: "" })}>
        <option value="GLOBAL">Everything</option><option value="COUNTRY">A country</option><option value="CATEGORY">A category</option><option value="VENDOR">A supplier</option>
      </Select></F>
      {v.scope !== "GLOBAL" && <F label="Which"><Select name="marginTarget" value={v.target} onChange={(e) => setV({ ...v, target: e.target.value })}><option value="">Choose…</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></F>}
      <F label="Minimum margin %"><Input name="minMargin" type="number" step="0.5" className="w-28" value={v.min} onChange={(e) => setV({ ...v, min: e.target.value })} /></F>
      <F label="Target %"><Input name="targetMargin" type="number" step="0.5" className="w-24" value={v.goal} onChange={(e) => setV({ ...v, goal: e.target.value })} /></F>
      <F label="Note"><Input name="marginNote" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></F>
      <Button disabled={pending || v.min === ""} onClick={() => run(() => saveMarginRuleAction({
        scope: v.scope as "GLOBAL", countryId: v.scope === "COUNTRY" ? v.target : null, categoryId: v.scope === "CATEGORY" ? v.target : null, vendorCompanyId: v.scope === "VENDOR" ? v.target : null,
        minMarginPercent: Number(v.min), targetMarginPercent: v.goal === "" ? null : Number(v.goal), note: v.note || null,
      }), "Saved")}>Save rule</Button>
      <Msg error={error} msg={msg} />
    </div>
  );
}

export function RemoveRule({ id }: { id: string }) {
  const { pending, run } = useAct();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => removeMarginRuleAction({ id }))}>Remove</Button>;
}

export function KpiTargetForm({ month, metric, target, step = "1" }: { month: string; metric: string; target: number | null; step?: string }) {
  const { pending, error, msg, run } = useAct();
  const [v, setV] = useState(target === null ? "" : String(target));
  return (
    <span className="inline-flex items-center gap-1" data-testid={`target-${metric}`}>
      <Input aria-label="Target" type="number" step={step} className="h-8 w-28 text-right" value={v} onChange={(e) => setV(e.target.value)} />
      <Button size="sm" variant="outline" className="h-8" disabled={pending} onClick={() => run(() => setKpiTargetAction({ month, metric, target: v === "" ? null : Number(v) }), "✓")}>Set</Button>
      <Msg error={error} msg={msg} />
    </span>
  );
}

export function ModerateRating({ id, hidden }: { id: string; hidden: boolean }) {
  const { pending, run } = useAct();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => moderateRatingAction({ id, hidden: !hidden }))}>{hidden ? "Show" : "Hide"}</Button>;
}

// ── translated (customer / supplier) ────────────────────────────────────────

function Stars({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n}/5`} onClick={() => onChange(n)}
          className={`text-2xl leading-none transition-transform hover:scale-125 ${n <= value ? "text-[color:var(--vivid-orange)] drop-shadow" : "text-muted-foreground/40"}`}>★</button>
      ))}
    </div>
  );
}

export function RateOrderForm({ orderId, initial, l }: { orderId: string; initial: { stars: number; deliveryStars: number | null; comment: string | null } | null; l: Record<string, string> }) {
  const { pending, error, msg, run } = useAct();
  const [stars, setStars] = useState(initial?.stars ?? 0);
  const [ds, setDs] = useState(initial?.deliveryStars ?? 0);
  const [comment, setComment] = useState(initial?.comment ?? "");
  return (
    <div className="space-y-2 text-sm" data-testid="rate-order">
      <div className="flex flex-wrap items-center gap-3"><span className="w-28 text-muted-foreground">{l.order}</span><Stars value={stars} onChange={setStars} label={l.order} /></div>
      <div className="flex flex-wrap items-center gap-3"><span className="w-28 text-muted-foreground">{l.delivery}</span><Stars value={ds} onChange={setDs} label={l.delivery} /></div>
      <textarea aria-label={l.comment} placeholder={l.comment} className="min-h-16 w-full rounded-md border bg-background p-2" value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="flex items-center gap-2">
        <Button disabled={pending || !stars} onClick={() => run(() => rateOrderAction({ orderId, stars, deliveryStars: ds || null, comment: comment || null }), l.thanks, false)}>{initial ? l.update : l.send}</Button>
        <Msg error={error} msg={msg} />
      </div>
    </div>
  );
}

export function ReplyRatingForm({ id, reply, l }: { id: string; reply: string | null; l: Record<string, string> }) {
  const { pending, error, msg, run } = useAct();
  const [v, setV] = useState(reply ?? "");
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Input aria-label={l.reply} placeholder={l.reply} className="h-8 min-w-60 flex-1" value={v} onChange={(e) => setV(e.target.value)} />
      <Button size="sm" disabled={pending || !v.trim()} onClick={() => run(() => replyRatingAction({ id, reply: v }), "✓")}>{l.send}</Button>
      <Msg error={error} msg={msg} />
    </div>
  );
}
