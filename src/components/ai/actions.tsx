"use client";
/** Suggestion accept / dismiss, refresh, buy again, AI settings. */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, RefreshCw, ShoppingCart, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { buyAgainAction, decideRecommendationAction, refreshAiAction, saveAiSettingsAction } from "@/server/actions/ai";
import { AI_MODEL_LABEL, AI_MODELS, type AiSettings } from "@/lib/ai";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return { pending, msg, setMsg, router, start };
}
const Msg = ({ msg }: { msg: { ok: boolean; text: string } | null }) => msg && <span role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</span>;

export function RecDecision({ id, acceptLabel = "Accept", dismissLabel = "Dismiss", doneLabel }: { id: string; acceptLabel?: string; dismissLabel?: string; doneLabel?: string }) {
  const { pending, msg, setMsg, router, start } = useRun();
  const run = (accept: boolean) => start(async () => {
    const r = await decideRecommendationAction({ id, accept });
    if (r.ok) { setMsg(doneLabel ? { ok: true, text: doneLabel } : null); router.refresh(); } else setMsg({ ok: false, text: r.error });
  });
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="rec-decision">
      <Button size="sm" disabled={pending} onClick={() => run(true)}><Check className="size-3.5" aria-hidden /> {acceptLabel}</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(false)}><X className="size-3.5" aria-hidden /> {dismissLabel}</Button>
      <Msg msg={msg} />
    </div>
  );
}

export function RefreshInsights() {
  const { pending, msg, setMsg, router, start } = useRun();
  return (
    <div className="flex items-center gap-2">
      <Msg msg={msg} />
      <Button variant="outline" disabled={pending} data-testid="refresh-ai" onClick={() => start(async () => {
        const r = await refreshAiAction({});
        if (r.ok) { setMsg({ ok: true, text: `${r.data.created} new, ${r.data.expired} expired` }); router.refresh(); } else setMsg({ ok: false, text: r.error });
      })}><RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} aria-hidden /> Refresh now</Button>
    </div>
  );
}

export function BuyAgainButton({ sellerId, locale, label, done, cartHref, cartLabel, variant = "default" }: { sellerId: string; locale: string; label: string; done: string; cartHref: string; cartLabel: string; variant?: "default" | "outline" }) {
  const { pending, msg, setMsg, router, start } = useRun();
  const [added, setAdded] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="buy-again">
      <Button size="sm" variant={variant} disabled={pending} onClick={() => start(async () => {
        const r = await buyAgainAction({ sellerId, locale });
        if (r.ok) { setAdded(true); setMsg({ ok: true, text: done.replace("{n}", String(r.data.added)) }); router.refresh(); } else setMsg({ ok: false, text: r.error });
      })}><ShoppingCart className="size-4" aria-hidden /> {label}</Button>
      <Msg msg={msg} />
      {added && <a href={cartHref} className="text-sm font-medium text-primary underline-offset-4 hover:underline">{cartLabel}</a>}
    </div>
  );
}

export function AiSettingsForm({ settings }: { settings: AiSettings }) {
  const { pending, msg, setMsg, router, start } = useRun();
  const [v, setV] = useState(settings);
  const box = (k: "staff" | "buyers" | "suppliers" | "photos", label: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={k} checked={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} /> {label}</label>;
  return (
    <div className="space-y-3" data-testid="ai-settings">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="ai-model">Model</Label>
          <Select id="ai-model" value={v.model} onChange={(e) => setV({ ...v, model: e.target.value as AiSettings["model"] })}>{AI_MODELS.map((m) => <option key={m} value={m}>{AI_MODEL_LABEL[m]}</option>)}</Select>
        </div>
        <div className="space-y-1"><Label htmlFor="ai-limit">Questions per person per hour</Label>
          <input id="ai-limit" type="number" min={1} max={500} value={v.hourlyLimit} onChange={(e) => setV({ ...v, hourlyLimit: Number(e.target.value) })} className="h-9 w-full rounded-md border bg-background px-3 text-sm" />
        </div>
      </div>
      <fieldset className="flex flex-wrap gap-4"><legend className="mb-1 text-sm font-medium">Assistant available to</legend>{box("staff", "FIRINGI staff")}{box("buyers", "Customers")}{box("suppliers", "Suppliers")}<p className="w-full text-xs text-muted-foreground">Unticking Customers or Suppliers switches the Assistant off for all of them at once. When ticked, it is on per company unless switched off in Settings &rsaquo; Business Features (&ldquo;Assistant&rdquo;).</p></fieldset>
      <fieldset className="flex flex-wrap gap-4"><legend className="mb-1 text-sm font-medium">Photos &amp; barcode scan</legend>{box("photos", "Customers and suppliers can send photos and scan barcodes in the Assistant")}<p className="w-full text-xs text-muted-foreground">Photos need the AI connected and cost a little more per question. Per company: Settings &rsaquo; Business Features (&ldquo;Photos&rdquo;).</p></fieldset>
      <div className="flex items-center gap-2">
        <Button disabled={pending} onClick={() => start(async () => { const r = await saveAiSettingsAction(v); setMsg(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.error }); if (r.ok) router.refresh(); })}>Save AI settings</Button>
        <Msg msg={msg} />
      </div>
    </div>
  );
}
