"use client";
/** Pre-orders & price locks (Phase 71) — the supplier's forms: campaign editor, send / close / cancel / order, price-lock answers. */
import { useState } from "react";
import { Ban, Check, Lock, PackagePlus, Plus, Save, Send, Trash2, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { cancelCampaignAction, closeCampaignNowAction, decideLockAction, orderCampaignNowAction, saveCampaignAction, submitCampaignAction } from "@/server/actions/preorders";

type L = Record<string, string>;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
export type OfferOpt = { id: string; label: string; price: number | null };
type Item = { offerId: string; unitNet: string; minQty: string; maxQty: string; supplyQty: string; tiers: { minTotal: string; unitNet: string }[] };
export type CampaignInit = { kind: string; title: string; description: string; opensAt: string; closesAt: string; deliveryDates: string[]; allocation: string; depositPct: string; items: Item[] };

export function CampaignForm({ l, id, offers, init, kinds, allocs, maxDeposit, deposits }: { l: L; id: string | null; offers: OfferOpt[]; init: CampaignInit; kinds: { value: string; label: string }[]; allocs: { value: string; label: string }[]; maxDeposit: number; deposits: boolean }) {
  const { pending, error, done, run, router } = useRun();
  const [v, setV] = useState<CampaignInit>(init);
  const set = <K extends keyof CampaignInit>(k: K, x: CampaignInit[K]) => setV({ ...v, [k]: x });
  const setItem = (i: number, p: Partial<Item>) => set("items", v.items.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const n = (s: string) => (s.trim() === "" ? null : Number(s));
  const payload = () => ({
    kind: v.kind, title: v.title, description: v.description || null, opensAt: v.opensAt, closesAt: v.closesAt, deliveryDates: v.deliveryDates.filter(Boolean), allocation: v.allocation, depositPct: Number(v.depositPct || 0),
    items: v.items.filter((x) => x.offerId).map((x) => ({ offerId: x.offerId, unitNet: Number(x.unitNet), minQty: Number(x.minQty || 1), maxQty: n(x.maxQty), supplyQty: n(x.supplyQty), tiers: x.tiers.filter((t) => t.minTotal && t.unitNet).map((t) => ({ minTotal: Number(t.minTotal), unitNet: Number(t.unitNet) })) })),
  });
  return (
    <form className="space-y-5" data-testid="pc-form" onSubmit={(e) => { e.preventDefault(); run(() => saveCampaignAction({ id, input: payload() }), (d) => { if (!id) router.push(`/vendor/orders/preorders/${(d as { id: string }).id}`); }, l.sellerSaved); }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="pc-title">{l.sellerTitleField}</Label><Input id="pc-title" value={v.title} maxLength={120} onChange={(e) => set("title", e.target.value)} data-testid="pc-title" /></div>
        <div className="space-y-1"><Label htmlFor="pc-kind">{l.sellerKind}</Label><Select id="pc-kind" value={v.kind} onChange={(e) => set("kind", e.target.value)} data-testid="pc-kind">{kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select></div>
        <div className="space-y-1 sm:col-span-3"><Label htmlFor="pc-desc">{l.sellerDescription}</Label><textarea id="pc-desc" className="min-h-16 w-full rounded-md border bg-background px-3 py-2 text-sm" maxLength={2000} value={v.description} onChange={(e) => set("description", e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="pc-open">{l.sellerOpens}</Label><Input id="pc-open" type="datetime-local" value={v.opensAt} onChange={(e) => set("opensAt", e.target.value)} data-testid="pc-opens" /></div>
        <div className="space-y-1"><Label htmlFor="pc-close">{l.sellerCloses}</Label><Input id="pc-close" type="datetime-local" value={v.closesAt} onChange={(e) => set("closesAt", e.target.value)} data-testid="pc-closes" /></div>
        <div className="space-y-1"><Label htmlFor="pc-dep">{l.sellerDeposit}</Label><Input id="pc-dep" type="number" min={0} max={maxDeposit} disabled={!deposits} value={v.depositPct} onChange={(e) => set("depositPct", e.target.value)} data-testid="pc-deposit" /></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="pc-alloc">{l.allocLabel}</Label><Select id="pc-alloc" value={v.allocation} onChange={(e) => set("allocation", e.target.value)} data-testid="pc-alloc">{allocs.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</Select></div>
      </div>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{l.deliveryDates}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {v.deliveryDates.map((d, k) => (
            <span key={k} className="inline-flex items-center gap-1"><Input type="date" className="h-9 w-40" value={d} onChange={(e) => set("deliveryDates", v.deliveryDates.map((x, j) => (j === k ? e.target.value : x)))} data-testid="pc-date" />
              {v.deliveryDates.length > 1 && <Button type="button" size="sm" variant="ghost" aria-label={l.sellerRemove} onClick={() => set("deliveryDates", v.deliveryDates.filter((_, j) => j !== k))}><X className="size-4" /></Button>}</span>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => set("deliveryDates", [...v.deliveryDates, ""])} data-testid="pc-add-date"><Plus className="size-4" /> {l.sellerAddDate}</Button>
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{l.sellerProducts}</h3>
        {v.items.map((it, i) => (
          <div key={i} className="space-y-2 rounded-lg border p-3" data-testid="pc-item">
            <div className="grid gap-2 sm:grid-cols-6">
              <div className="space-y-1 sm:col-span-6"><Label className="text-xs" htmlFor={`pi-o-${i}`}>{l.product}</Label>
                <Select id={`pi-o-${i}`} value={it.offerId} onChange={(e) => { const o = offers.find((x) => x.id === e.target.value); setItem(i, { offerId: e.target.value, unitNet: it.unitNet || (o?.price ? String(o.price) : "") }); }} data-testid="pc-offer">
                  <option value="">{l.sellerChooseProduct}</option>{offers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </Select></div>
              <div className="space-y-1"><Label className="text-xs" htmlFor={`pi-p-${i}`}>{l.sellerPrice}</Label><Input id={`pi-p-${i}`} type="number" step="0.01" min={0} value={it.unitNet} onChange={(e) => setItem(i, { unitNet: e.target.value })} data-testid="pc-price" /></div>
              <div className="space-y-1"><Label className="text-xs" htmlFor={`pi-mi-${i}`}>{l.sellerMin}</Label><Input id={`pi-mi-${i}`} type="number" min={1} value={it.minQty} onChange={(e) => setItem(i, { minQty: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs" htmlFor={`pi-ma-${i}`}>{l.sellerMax}</Label><Input id={`pi-ma-${i}`} type="number" min={1} value={it.maxQty} onChange={(e) => setItem(i, { maxQty: e.target.value })} /></div>
              <div className="space-y-1 sm:col-span-2"><Label className="text-xs" htmlFor={`pi-s-${i}`}>{l.sellerSupply}</Label><Input id={`pi-s-${i}`} type="number" min={1} placeholder={l.sellerSupplyHint} value={it.supplyQty} onChange={(e) => setItem(i, { supplyQty: e.target.value })} data-testid="pc-supply" /></div>
              <div className="flex items-end"><Button type="button" size="sm" variant="ghost" aria-label={l.sellerRemove} onClick={() => set("items", v.items.filter((_, k) => k !== i))}><Trash2 className="size-4" /></Button></div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <span className="text-xs text-muted-foreground">{l.tierLabel}:</span>
              {it.tiers.map((t, k) => (
                <span key={k} className="inline-flex items-end gap-1">
                  <Input aria-label={l.sellerTierFrom} type="number" min={1} className="h-8 w-24" placeholder={l.sellerTierFrom} value={t.minTotal} onChange={(e) => setItem(i, { tiers: it.tiers.map((x, j) => (j === k ? { ...x, minTotal: e.target.value } : x)) })} data-testid="pc-tier-min" />
                  <Input aria-label={l.sellerTierPrice} type="number" step="0.01" min={0} className="h-8 w-24" placeholder={l.sellerTierPrice} value={t.unitNet} onChange={(e) => setItem(i, { tiers: it.tiers.map((x, j) => (j === k ? { ...x, unitNet: e.target.value } : x)) })} data-testid="pc-tier-price" />
                </span>
              ))}
              {it.tiers.length < 3 && <Button type="button" size="sm" variant="outline" onClick={() => setItem(i, { tiers: [...it.tiers, { minTotal: "", unitNet: "" }] })} data-testid="pc-add-tier"><Plus className="size-4" /> {l.sellerAddTier}</Button>}
            </div>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={() => set("items", [...v.items, { offerId: "", unitNet: "", minQty: "1", maxQty: "", supplyQty: "", tiers: [] }])} data-testid="pc-add-item"><PackagePlus className="size-4" /> {l.sellerAddProduct}</Button>
      </section>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={pending} data-testid="pc-save"><Spin on={pending} icon={Save} /> {l.sellerSave}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function CampaignActions({ l, id, status, auto, dates }: { l: L; id: string; status: string; auto: boolean; dates: { value: string; label: string }[] }) {
  const { pending, error, done, run } = useRun();
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {(status === "DRAFT" || status === "REJECTED") && <Button disabled={pending} onClick={() => run(() => submitCampaignAction({ id }), undefined, l.sellerSubmitted)} data-testid="pc-submit"><Spin on={pending} icon={Send} /> {auto ? l.sellerSubmitAuto : l.sellerSubmit}</Button>}
        {status === "OPEN" && <Button variant="outline" disabled={pending} onClick={() => run(() => closeCampaignNowAction({ id }), undefined, l.sellerClosed)} data-testid="pc-close"><Spin on={pending} icon={Check} /> {l.sellerCloseNow}</Button>}
        {status === "ALLOCATED" && dates.map((d) => <Button key={d.value} variant="outline" disabled={pending} onClick={() => run(() => orderCampaignNowAction({ id, date: d.value }), (x) => setMsg(f(l.sellerOrdered, { n: (x as { placed: number }).placed })))} data-testid="pc-order"><Spin on={pending} icon={Truck} /> {l.sellerOrderNow} · {d.label}</Button>)}
        {!["DONE", "CANCELLED"].includes(status) && <Button variant="ghost" disabled={pending} onClick={() => setAsking(!asking)} data-testid="pc-cancel-open"><Ban className="size-4" /> {l.sellerCancel}</Button>}
        <Msg error={error} done={msg ?? done} />
      </div>
      {asking && <div className="flex flex-wrap items-center gap-2"><Input className="max-w-md" placeholder={l.sellerCancelReason} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="pc-cancel-reason" /><Button variant="destructive" disabled={pending} onClick={() => run(() => cancelCampaignAction({ id, reason }))} data-testid="pc-cancel"><Ban className="size-4" /> {l.sellerCancel}</Button></div>}
    </div>
  );
}

export function LockDecision({ l, id, price, maxDeposit, deposits }: { l: L; id: string; price: number; maxDeposit: number; deposits: boolean }) {
  const { pending, error, done, run } = useRun();
  const [p, setP] = useState(String(price));
  const [dep, setDep] = useState("0");
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="vl-decide">
      <div className="space-y-1"><Label className="text-xs" htmlFor={`vp-${id}`}>{l.sellerAcceptAt}</Label><Input id={`vp-${id}`} type="number" step="0.01" min={0} className="h-9 w-28" value={p} onChange={(e) => setP(e.target.value)} data-testid="vl-price" /></div>
      {deposits && <div className="space-y-1"><Label className="text-xs" htmlFor={`vd-${id}`}>{l.sellerDepositPct}</Label><Input id={`vd-${id}`} type="number" min={0} max={maxDeposit} className="h-9 w-20" value={dep} onChange={(e) => setDep(e.target.value)} /></div>}
      <div className="min-w-0 flex-1 basis-40 space-y-1"><Label className="text-xs" htmlFor={`vn-${id}`}>{l.note}</Label><Input id={`vn-${id}`} className="h-9" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <Button size="sm" disabled={pending} onClick={() => run(() => decideLockAction({ input: { id, accept: true, unitNet: Number(p), depositPct: Number(dep || 0), note: note || null } }), undefined, l.sellerDecided)} data-testid="vl-accept"><Spin on={pending} icon={Lock} /> {l.sellerAccept}</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideLockAction({ input: { id, accept: false, note: note || null } }), undefined, l.sellerDecided)} data-testid="vl-reject"><X className="size-4" /> {l.sellerReject}</Button>
      <Msg error={error} done={done} />
    </div>
  );
}
