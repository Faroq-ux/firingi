"use client";
/** Open tenders (Phase 50) — the buyer's tender form and award, the supplier's bid. Texts come in as `l`. */
import { useEffect, useMemo, useState } from "react";
import { Ban, Check, Gavel, Lock, Plus, Search, Send, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { awardTenderAction, cancelTenderAction, closeTenderAction, createTenderAction, searchTenderProductsAction, submitBidAction, withdrawBidAction } from "@/server/actions/tenders";

export type L = Record<string, string>;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const textarea = "min-h-16 w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

type Line = { key: number; productId: string | null; product: string; description: string; qty: string; unitNote: string; target: string };
const blank = (key: number): Line => ({ key, productId: null, product: "", description: "", qty: "1", unitNote: "", target: "" });

function ProductPicker({ l, line, onPick }: { l: L; line: Line; onPick: (p: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => { const r = await searchTenderProductsAction({ q }); if (r.ok) setHits(r.data as typeof hits); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  if (line.productId) return <p className="flex flex-wrap items-center gap-2 text-sm"><span className="min-w-0 break-words font-medium">{line.product}</span><button type="button" className="text-xs text-primary hover:underline" onClick={() => onPick(null)}>{l.change}</button></p>;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 rounded-lg border px-2"><Search className="size-4 text-muted-foreground" /><input className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder={l.findProduct} value={q} onChange={(e) => setQ(e.target.value)} data-testid="td-product-search" /></div>
      {hits.length > 0 && <ul className="max-h-40 overflow-y-auto rounded-lg border p-1 text-sm">{hits.map((h) => <li key={h.id}><button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-muted/60" onClick={() => { onPick(h); setQ(""); }} data-testid="td-product-hit">{h.name}</button></li>)}</ul>}
    </div>
  );
}

export function NewTenderForm({ l, addresses, suppliers, opts }: { l: L; addresses: { id: string; label: string }[]; suppliers: { id: string; name: string }[]; opts: { invitations: boolean; targetPrices: boolean; minHours: number; maxDays: number; maxLines: number } }) {
  const { pending, error, run, router } = useRun();
  const [title, setTitle] = useState(""), [note, setNote] = useState(""), [addressId, setAddressId] = useState(addresses[0]?.id ?? "");
  const [closes, setCloses] = useState(() => localInput(new Date(Date.now() + Math.max(opts.minHours, 72) * 3_600_000)));
  const [delivery, setDelivery] = useState(() => new Date(Date.now() + (Math.max(opts.minHours, 72) / 24 + 3) * 86_400_000).toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([blank(1)]), [invite, setInvite] = useState<string[]>([]), [onlyInvited, setOnlyInvited] = useState(false);
  const set = (k: number, p: Partial<Line>) => setLines((ls) => ls.map((x) => (x.key === k ? { ...x, ...p } : x)));
  const submit = () => run(() => createTenderAction({
    title, note: note || null, addressId, deliveryDate: delivery || null, closesAt: new Date(closes).toISOString(), invitedIds: onlyInvited ? invite : [],
    lines: lines.map((x) => ({ productId: x.productId, description: x.description || null, qty: Math.floor(Number(x.qty)), unitNote: x.unitNote || null, targetUnitNet: x.target ? Number(x.target) : null })),
  }), (d) => router.push(`/buy/orders/tenders/${(d as { id: string }).id}`));
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="td-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label htmlFor="td-title">{l.titleLabel}</Label><Input id="td-title" required maxLength={120} placeholder={l.titlePh} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="td-title" /></div>
        <div><Label htmlFor="td-addr">{l.deliverTo}</Label><Select id="td-addr" value={addressId} onChange={(e) => setAddressId(e.target.value)}>{addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></div>
        <div><Label htmlFor="td-deliv">{l.deliveryDate}</Label><Input id="td-deliv" type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} /></div>
        <div><Label htmlFor="td-closes">{l.closesAt}</Label><Input id="td-closes" type="datetime-local" required value={closes} onChange={(e) => setCloses(e.target.value)} data-testid="td-closes" /><p className="mt-1 text-xs text-muted-foreground">{f(l.closesHint, { hours: opts.minHours, days: opts.maxDays })}</p></div>
        <div className="sm:col-span-2"><Label htmlFor="td-note">{l.noteLabel}</Label><textarea id="td-note" className={textarea} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-medium">{l.linesTitle}</h3>
        {lines.map((x, i) => (
          <div key={x.key} className="space-y-2 rounded-lg border p-3" data-testid="td-line">
            <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-muted-foreground">{f(l.lineN, { n: i + 1 })}</span>{lines.length > 1 && <Button type="button" size="sm" variant="ghost" aria-label={l.remove} onClick={() => setLines((ls) => ls.filter((y) => y.key !== x.key))}><Trash2 className="size-4" /></Button>}</div>
            <ProductPicker l={l} line={x} onPick={(p) => set(x.key, { productId: p?.id ?? null, product: p?.name ?? "" })} />
            <Input placeholder={x.productId ? l.detailsPh : l.describePh} value={x.description} maxLength={300} onChange={(e) => set(x.key, { description: e.target.value })} aria-label={l.describePh} data-testid="td-line-desc" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div><Label>{l.qty}</Label><Input type="number" min={1} value={x.qty} onChange={(e) => set(x.key, { qty: e.target.value })} data-testid="td-line-qty" /></div>
              <div><Label>{l.unitNote}</Label><Input placeholder={l.unitNotePh} maxLength={60} value={x.unitNote} onChange={(e) => set(x.key, { unitNote: e.target.value })} /></div>
              {opts.targetPrices && <div className="col-span-2 sm:col-span-1"><Label>{l.target}</Label><Input type="number" step="0.01" min={0} placeholder="€" value={x.target} onChange={(e) => set(x.key, { target: e.target.value })} /></div>}
            </div>
          </div>
        ))}
        {lines.length < opts.maxLines && <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blank(Math.max(...ls.map((y) => y.key)) + 1)])} data-testid="td-add-line"><Plus className="size-4" /> {l.addLine}</Button>}
      </div>
      {opts.invitations && suppliers.length > 0 && (
        <fieldset className="space-y-2 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">{l.whoBids}</legend>
          <label className="flex items-center gap-2 text-sm"><input type="radio" checked={!onlyInvited} onChange={() => setOnlyInvited(false)} /> {f(l.allSuppliers, { n: suppliers.length })}</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" checked={onlyInvited} onChange={() => setOnlyInvited(true)} /> {l.onlyInvited}</label>
          {onlyInvited && <ul className="max-h-48 overflow-y-auto rounded border p-1">{suppliers.map((s) => <li key={s.id}><label className="flex items-center gap-2 px-2 py-1 text-sm"><input type="checkbox" checked={invite.includes(s.id)} onChange={(e) => setInvite((v) => (e.target.checked ? [...v, s.id] : v.filter((y) => y !== s.id)))} /> <span className="min-w-0 break-words">{s.name}</span></label></li>)}</ul>}
        </fieldset>
      )}
      <Button type="submit" disabled={pending || !title.trim()} data-testid="td-submit"><Spin on={pending} icon={Send} /> {l.publish}</Button>
      <Msg error={error} />
    </form>
  );
}

export function TenderButtons({ l, id, open }: { l: L; id: string; open: boolean }) {
  const { pending, error, run } = useRun();
  return (
    <span className="flex flex-wrap items-center gap-2">
      {open && <Button size="sm" variant="outline" disabled={pending} onClick={() => { if (window.confirm(l.closeConfirm)) run(() => closeTenderAction({ id })); }} data-testid="td-close"><Lock className="size-4" /> {l.closeNow}</Button>}
      <Button size="sm" variant="outline" disabled={pending} onClick={() => { if (window.confirm(l.cancelConfirm)) run(() => cancelTenderAction({ id })); }} data-testid="td-cancel"><Ban className="size-4" /> {l.cancel}</Button>
      <Msg error={error} />
    </span>
  );
}

type Bid = { bidLineId: string; supplier: string; offer: string; unitNet: number; total: number; rank: number; belowTarget: number | null; note: string | null };
export function AwardForm({ l, id, lines, locale, payLater }: { l: L; id: string; locale: string; lines: { id: string; n: number; description: string; qty: number; bids: Bid[] }[]; payLater: { id: string; label: string }[] | null }) {
  const { pending, error, run } = useRun();
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  const [picks, setPicks] = useState<Record<string, string | null>>(() => Object.fromEntries(lines.map((x) => [x.id, x.bids[0]?.bidLineId ?? null])));
  const [term, setTerm] = useState(""), [result, setResult] = useState<string | null>(null);
  const total = useMemo(() => lines.reduce((a, x) => a + (x.bids.find((b) => b.bidLineId === picks[x.id])?.total ?? 0), 0), [lines, picks]);
  return (
    <div className="space-y-4" data-testid="td-award">
      {lines.map((x) => (
        <div key={x.id} className="rounded-lg border p-3" data-testid="td-award-line">
          <p className="mb-2 break-words text-sm font-medium">{x.n}. {x.description} <span className="font-normal text-muted-foreground">× {x.qty}</span></p>
          {!x.bids.length ? <p className="text-xs text-muted-foreground">{l.noBids}</p> : (
            <ul className="space-y-1.5">
              {x.bids.map((b) => (
                <li key={b.bidLineId}>
                  <label className="flex flex-wrap items-start gap-2 text-sm">
                    <input type="radio" className="mt-1" name={`l-${x.id}`} checked={picks[x.id] === b.bidLineId} onChange={() => setPicks((p) => ({ ...p, [x.id]: b.bidLineId }))} data-testid="td-pick" />
                    <span className="min-w-0 flex-1"><span className="font-medium">{b.supplier}</span>{b.rank === 1 && <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">{l.best}</span>}<span className="block break-words text-xs text-muted-foreground">{b.offer}{b.note ? ` · “${b.note}”` : ""}</span></span>
                    <span className="text-right tabular-nums">{money(b.unitNet)}<span className="block text-xs text-muted-foreground">{money(b.total)}{b.belowTarget != null && b.belowTarget > 0 ? ` · ${f(l.belowTarget, { amount: money(b.belowTarget) })}` : ""}</span></span>
                  </label>
                </li>
              ))}
              <li><label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="radio" name={`l-${x.id}`} checked={!picks[x.id]} onChange={() => setPicks((p) => ({ ...p, [x.id]: null }))} /> {l.dontAward}</label></li>
            </ul>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-3">
        <p className="text-sm">{l.awardTotal}: <b className="tabular-nums" data-testid="td-award-total">{money(total)}</b> <span className="text-xs text-muted-foreground">{l.exclVat}</span></p>
        {payLater && payLater.length > 0 && <div className="min-w-48"><Label htmlFor="td-pl">{l.payment}</Label><Select id="td-pl" value={term} onChange={(e) => setTerm(e.target.value)}><option value="">{l.payUsual}</option>{payLater.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></div>}
        <Button disabled={pending || total <= 0} onClick={() => { if (window.confirm(l.awardConfirm)) run(() => awardTenderAction({ id, picks, payLaterTermId: term || null }), (d) => { const r = d as { placed: unknown[]; failed: { error: string }[] }; setResult(f(l.awarded, { orders: r.placed.length }) + (r.failed.length ? ` ${f(l.someFailed, { reason: r.failed.map((x) => x.error).join(" / ") })}` : "")); }); }} data-testid="td-award-btn"><Spin on={pending} icon={Gavel} /> {l.award}</Button>
      </div>
      <Msg error={error} done={result} />
    </div>
  );
}

type SLine = { id: string; n: number; description: string; productId: string | null; qty: number; unitNote: string | null; targetUnitNet: number | null; suggested: string[]; mine: { offerId: string; unitNet: number } | null };
export function BidForm({ l, tenderId, lines, offers, commissionPct, locale, hasBid, note: initialNote }: { l: L; tenderId: string; lines: SLine[]; offers: { id: string; label: string; base: number | null }[]; commissionPct: number | null; locale: string; hasBid: boolean; note: string | null }) {
  const { pending, error, done, run } = useRun();
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  const [rows, setRows] = useState(() => Object.fromEntries(lines.map((x) => [x.id, { offerId: x.mine?.offerId ?? x.suggested[0] ?? "", price: x.mine ? String(x.mine.unitNet) : "" }])));
  const [note, setNote] = useState(initialNote ?? "");
  const set = (id: string, p: Partial<{ offerId: string; price: string }>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...p } }));
  const label = new Map(offers.map((o) => [o.id, o]));
  return (
    <div className="space-y-3" data-testid="td-bid">
      {lines.map((x) => {
        const r = rows[x.id], choices = x.productId ? offers.filter((o) => x.suggested.includes(o.id)) : offers;
        const price = Number(r.price) || 0;
        return (
          <div key={x.id} className="space-y-2 rounded-lg border p-3" data-testid="td-bid-line">
            <p className="break-words text-sm font-medium">{x.n}. {x.description} <span className="font-normal text-muted-foreground">× {x.qty}{x.unitNote ? ` (${x.unitNote})` : ""}</span></p>
            {x.targetUnitNet != null && <p className="text-xs text-muted-foreground">{f(l.buyerTarget, { price: money(x.targetUnitNet) })}</p>}
            {!choices.length ? <p className="text-xs text-muted-foreground">{l.noMatchingOffer}</p> : (
              <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
                <Select aria-label={l.yourProduct} value={r.offerId} onChange={(e) => set(x.id, { offerId: e.target.value })} data-testid="td-bid-offer"><option value="">{l.skipLine}</option>{choices.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
                <Input type="number" step="0.01" min={0} aria-label={l.yourPrice} placeholder={l.yourPrice} value={r.price} onChange={(e) => set(x.id, { price: e.target.value })} data-testid="td-bid-price" />
              </div>
            )}
            {r.offerId && price > 0 && <p className="text-xs text-muted-foreground">{[label.get(r.offerId)?.base != null ? f(l.yourBase, { price: money(label.get(r.offerId)!.base!) }) : null, f(l.lineTotal, { amount: money(price * x.qty) }), commissionPct != null ? f(l.youReceive, { amount: money(price * x.qty * (1 - commissionPct / 100)) }) : null].filter(Boolean).join(" · ")}</p>}
          </div>
        );
      })}
      <div><Label htmlFor="td-bnote">{l.bidNote}</Label><textarea id="td-bnote" className={textarea} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending} onClick={() => run(() => submitBidAction({ tenderId, note: note || null, lines: lines.map((x) => ({ lineId: x.id, offerId: rows[x.id].offerId, unitNet: Number(rows[x.id].price) || 0 })).filter((x) => x.offerId && x.unitNet > 0) }), undefined, l.bidSent)} data-testid="td-bid-send"><Spin on={pending} icon={Check} /> {hasBid ? l.updateBid : l.sendBid}</Button>
        {hasBid && <Button variant="outline" disabled={pending} onClick={() => { if (window.confirm(l.withdrawConfirm)) run(() => withdrawBidAction({ tenderId })); }} data-testid="td-bid-withdraw"><Undo2 className="size-4" /> {l.withdraw}</Button>}
      </div>
      <p className="text-xs text-muted-foreground">{l.sealedNote}</p>
      <Msg error={error} done={done} />
    </div>
  );
}
