"use client";
/** Clearance deals (Phase 38) — interactive parts for buyers and suppliers (texts passed in as `l`). */
import { useEffect, useMemo, useState } from "react";
import { Ban, Bell, BellOff, Check, Gavel, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { addToCartAction } from "@/server/actions/orders";
import { answerBidAction, cancelDealAction, createDealAction, dealFormInfoAction, digestAction, placeBidAction, respondCounterAction, watchAction } from "@/server/actions/deals";
import { bestDealUnit, discountPct, type DealKindKey, type Tier } from "@/lib/deals";

export type L = Record<string, string>;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const fmt = (n: number, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);

/** "ends in 2 d 5 h" — updates every minute. */
export function EndsIn({ l, endsAt }: { l: L; endsAt: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  if (now == null) return <span suppressHydrationWarning>{l.endsSoon}</span>;
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) return <span>{l.ended}</span>;
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return <span data-testid="ends-in">{d > 0 ? f(l.endsInDays, { d, h }) : f(l.endsInHours, { h, m })}</span>;
}

// ── buyers ──────────────────────────────────────────────────────────────────

export type BuyerDeal = {
  id: string; kind: DealKindKey; offerId: string; left: number | null; perBuyerMax: number | null; boughtByMe: number; listUnit: number; bestUnit: number | null;
  minQty: number; step: number; minBidQty: number | null; lotQty: number | null; tiers: Tier[] | null; bundleQty: number | null; bundlePrice: number | null;
  bid: { id: string; status: string; qty: number; unitPrice: number; counterPrice: number | null; expiresAt: string } | null;
};

export function BuyDeal({ l, d, locale }: { l: L; d: BuyerDeal; locale: string }) {
  const { pending, error, done, run } = useRun();
  const first = d.kind === "VOLUME" && d.tiers?.length ? d.tiers[0].minQty : d.kind === "BUNDLE" && d.bundleQty ? d.bundleQty : d.minQty;
  const [qty, setQty] = useState(Math.max(first, d.minQty));
  const unit = useMemo(() => {
    if (d.kind === "FLASH") return d.bestUnit ?? d.listUnit;
    if (d.kind === "VOLUME") return [...(d.tiers ?? [])].sort((a, b) => b.minQty - a.minQty).find((t) => qty >= t.minQty)?.unitPrice ?? d.listUnit;
    if (d.kind === "BUNDLE" && d.bundleQty && d.bundlePrice) { const p = Math.floor(qty / d.bundleQty); return qty ? (p * d.bundlePrice + (qty - p * d.bundleQty) * d.listUnit) / qty : d.listUnit; }
    return d.listUnit;
  }, [d, qty]);
  const room = Math.min(d.left ?? Infinity, d.perBuyerMax != null ? d.perBuyerMax - d.boughtByMe : Infinity);
  if (d.kind === "LOT") return (
    <div className="space-y-1">
      <Button disabled={pending || room < (d.lotQty ?? 0)} onClick={() => run(() => addToCartAction({ offerId: d.offerId, qty: d.lotQty! }), undefined, l.addedLot)} data-testid="buy-lot"><Spin on={pending} icon={ShoppingCart} /> {f(l.buyLot, { qty: d.lotQty ?? 0 })}</Button>
      <Msg error={error} done={done} />
    </div>
  );
  if (d.kind === "BEST_OFFER") return <BestOffer l={l} d={d} locale={locale} />;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="number" aria-label={l.qty} min={d.minQty} step={d.step} max={Number.isFinite(room) ? room : undefined} value={qty} onChange={(e) => setQty(Math.max(0, Math.floor(Number(e.target.value) || 0)))} className="h-9 w-24" data-testid="deal-qty" />
        <span className="text-sm tabular-nums text-muted-foreground">{f(l.unitAt, { price: fmt(unit, locale) })}</span>
        <Button size="sm" disabled={pending || qty < 1 || qty > room} onClick={() => run(() => addToCartAction({ offerId: d.offerId, qty }), undefined, l.added)} data-testid="deal-add"><Spin on={pending} icon={ShoppingCart} /> {l.addToCart}</Button>
      </div>
      {qty > room && <p className="text-xs text-destructive">{f(l.maxForYou, { n: Math.max(0, room) })}</p>}
      <Msg error={error} done={done} />
    </div>
  );
}

function BestOffer({ l, d, locale }: { l: L; d: BuyerDeal; locale: string }) {
  const { pending, error, done, run } = useRun();
  const [qty, setQty] = useState(Math.max(d.minBidQty ?? 1, d.minQty));
  const [price, setPrice] = useState(Math.round(d.listUnit * 0.85 * 100) / 100);
  const [msg, setMsg] = useState("");
  const b = d.bid;
  if (b && (b.status === "PENDING" || b.status === "ACCEPTED" || b.status === "COUNTERED")) return (
    <div className="space-y-2 rounded-lg border p-2.5 text-sm" data-testid="my-bid" data-status={b.status}>
      <p>{f(l[`bid.${b.status}`], { qty: b.qty, price: fmt(b.counterPrice ?? b.unitPrice, locale), mine: fmt(b.unitPrice, locale) })}</p>
      <div className="flex flex-wrap gap-2">
        {b.status === "ACCEPTED" && <Button size="sm" disabled={pending} onClick={() => run(() => addToCartAction({ offerId: d.offerId, qty: b.qty }), undefined, l.added)} data-testid="bid-cart"><Spin on={pending} icon={ShoppingCart} /> {f(l.addBidToCart, { qty: b.qty })}</Button>}
        {b.status === "COUNTERED" && <Button size="sm" disabled={pending} onClick={() => run(() => respondCounterAction({ bidId: b.id, accept: true }))} data-testid="bid-take"><Check className="size-4" /> {l.takeCounter}</Button>}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => respondCounterAction({ bidId: b.id, accept: false }))} data-testid="bid-withdraw"><X className="size-4" /> {l.withdraw}</Button>
      </div>
      <Msg error={error} done={done} />
    </div>
  );
  return (
    <form className="space-y-2" data-testid="bid-form" onSubmit={(e) => { e.preventDefault(); run(() => placeBidAction({ dealId: d.id, qty, unitPrice: price, message: msg || null }), undefined, l.bidSent); }}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label htmlFor={`bq-${d.id}`}>{l.qty}</Label><Input id={`bq-${d.id}`} type="number" min={d.minBidQty ?? 1} value={qty} onChange={(e) => setQty(Math.floor(Number(e.target.value) || 0))} className="h-9 w-24" data-testid="bid-qty" /></div>
        <div className="space-y-1"><Label htmlFor={`bp-${d.id}`}>{l.yourPrice}</Label><Input id={`bp-${d.id}`} type="number" step="0.01" min={0.01} value={price} onChange={(e) => setPrice(Number(e.target.value))} className="h-9 w-28" data-testid="bid-price" /></div>
        <Button size="sm" type="submit" disabled={pending} data-testid="bid-send"><Spin on={pending} icon={Gavel} /> {l.makeOffer}</Button>
      </div>
      <Input aria-label={l.message} placeholder={l.message} value={msg} maxLength={300} onChange={(e) => setMsg(e.target.value)} className="h-9" />
      {d.minBidQty ? <p className="text-xs text-muted-foreground">{f(l.minBid, { n: d.minBidQty })}</p> : null}
      <Msg error={error} done={done} />
    </form>
  );
}

export function WatchButton({ l, kind, id, on, label }: { l: L; kind: "PRODUCT" | "CATEGORY" | "SUPPLIER"; id: string; on: boolean; label: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" variant={on ? "secondary" : "outline"} disabled={pending} onClick={() => run(() => watchAction({ kind, id, on: !on }))} data-testid={`watch-${kind.toLowerCase()}`} aria-pressed={on}>
        {on ? <BellOff className="size-4" /> : <Bell className="size-4" />} {on ? f(l.unwatch, { what: label }) : f(l.watch, { what: label })}
      </Button>
      <Msg error={error} />
    </span>
  );
}

export function UnwatchRow({ l, kind, id }: { l: L; kind: "PRODUCT" | "CATEGORY" | "SUPPLIER"; id: string }) {
  const { pending, run } = useRun();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => watchAction({ kind, id, on: false }))} aria-label={l.remove}><Trash2 className="size-4" /></Button>;
}

export function DigestSwitch({ l, on: initial }: { l: L; on: boolean }) {
  const { pending, error, run } = useRun();
  const [on, setOn] = useState(initial);
  return (
    <span className="inline-flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={on} disabled={pending} onChange={(e) => { const v = e.target.checked; setOn(v); run(async () => { const r = await digestAction({ on: v }); if (!r.ok) setOn(!v); return r; }); }} data-testid="digest-switch" />{l.digest}</label>
      <Msg error={error} />
    </span>
  );
}

// ── suppliers ───────────────────────────────────────────────────────────────

type OfferOpt = { id: string; label: string };
type Info = { list: number | null; clearance: boolean; reason: string | null; bestBefore: string | null; lots: { id: string; lotCode: string | null; expiresOn: string | null; units: number }[]; usualCommission: number | null; clearanceCommission: number | null };
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function NewDealForm({ l, offers, kinds, locale, minPct }: { l: L; offers: OfferOpt[]; kinds: DealKindKey[]; locale: string; minPct: number }) {
  const { pending, error, done, run } = useRun();
  const [offerId, setOfferId] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [kind, setKind] = useState<DealKindKey>(kinds[0] ?? "FLASH");
  const [v, setV] = useState({ title: "", note: "", startsAt: local(new Date()), endsAt: local(new Date(Date.now() + 3 * 86_400_000)), maxQty: "", perBuyerMax: "", dealPrice: "", bundleQty: "3", bundlePrice: "", lotPrice: "", floorPrice: "", minBidQty: "", batchId: "" });
  const [tiers, setTiers] = useState<{ minQty: string; unitPrice: string }[]>([{ minQty: "10", unitPrice: "" }, { minQty: "50", unitPrice: "" }]);
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const terms = { kind, dealPrice: num(v.dealPrice), bundleQty: num(v.bundleQty), bundlePrice: num(v.bundlePrice), tiers: tiers.filter((t) => t.minQty && t.unitPrice).map((t) => ({ minQty: Number(t.minQty), unitPrice: Number(t.unitPrice) })), maxQty: num(v.maxQty), lotPrice: num(v.lotPrice) };
  const best = info?.list ? (kind === "BEST_OFFER" ? num(v.floorPrice) : bestDealUnit(terms, info.list)) : null;
  const pct = info?.list ? discountPct(best, info.list) : null;
  const pick = (id: string) => { setOfferId(id); setInfo(null); if (id) run(() => dealFormInfoAction({ offerId: id }), (d) => { const x = d as Info; setInfo(x); const lot = x.lots.find((lt) => lt.expiresOn && x.bestBefore && lt.expiresOn === x.bestBefore); setV((o) => ({ ...o, batchId: lot?.id ?? "" })); }); };
  const field = (k: keyof typeof v, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1"><Label htmlFor={`nd-${k}`}>{label}</Label><Input id={`nd-${k}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} data-testid={`nd-${k}`} {...props} /></div>
  );
  return (
    <form className="space-y-4" data-testid="new-deal" onSubmit={(e) => {
      e.preventDefault();
      run(() => createDealAction({
        offerId, kind, title: v.title || null, note: v.note || null, startsAt: new Date(v.startsAt).toISOString(), endsAt: new Date(v.endsAt).toISOString(),
        maxQty: num(v.maxQty), perBuyerMax: num(v.perBuyerMax), dealPrice: kind === "FLASH" ? num(v.dealPrice) : null, bundleQty: kind === "BUNDLE" ? num(v.bundleQty) : null, bundlePrice: kind === "BUNDLE" ? num(v.bundlePrice) : null,
        tiers: kind === "VOLUME" ? terms.tiers : null, lotPrice: kind === "LOT" ? num(v.lotPrice) : null, floorPrice: kind === "BEST_OFFER" ? num(v.floorPrice) : null, minBidQty: kind === "BEST_OFFER" ? num(v.minBidQty) : null, batchId: v.batchId || null,
      }), (d) => { const r = d as { status: string }; setV((o) => ({ ...o, dealPrice: "", bundlePrice: "", lotPrice: "", floorPrice: "" })); void r; }, l.created);
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="nd-offer">{l.product}</Label>
          <Select id="nd-offer" value={offerId} onChange={(e) => pick(e.target.value)} required data-testid="nd-offer"><option value="">{l.chooseProduct}</option>{offers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
        </div>
        <div className="space-y-1"><Label htmlFor="nd-kind">{l.kindLabel}</Label>
          <Select id="nd-kind" value={kind} onChange={(e) => setKind(e.target.value as DealKindKey)} data-testid="nd-kind">{kinds.map((k) => <option key={k} value={k}>{l[`kind.${k}`]}</option>)}</Select>
          <p className="text-xs text-muted-foreground">{l[`kindHint.${kind}`]}</p>
        </div>
      </div>
      {info && (
        <div className={`rounded-lg border p-3 text-sm ${info.clearance ? "border-[color:var(--success,#16a34a)]/40 bg-[color:var(--success,#16a34a)]/5" : "bg-muted/40"}`} data-testid="nd-info">
          <p>{f(l.listPrice, { price: info.list != null ? fmt(info.list, locale) : "—" })}{pct != null ? ` · ${f(l.discount, { pct })}` : ""}</p>
          {info.clearance
            ? <p className="font-medium">{f(l[`clearanceWhy.${info.reason}`], { date: info.bestBefore ?? "" })} {info.clearanceCommission != null && info.usualCommission != null ? f(l.clearanceCommission, { pct: info.clearanceCommission, usual: info.usualCommission }) : ""}</p>
            : <p className="text-muted-foreground">{f(l.normalCommission, { pct: info.usualCommission ?? "—" })}</p>}
          {pct != null && pct < minPct && kind !== "BEST_OFFER" && <p className="text-destructive">{f(l.minDiscount, { pct: minPct })}</p>}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kind === "FLASH" && field("dealPrice", l.dealPrice, { type: "number", step: "0.01", min: "0.01", required: true })}
        {kind === "BUNDLE" && <>{field("bundleQty", l.bundleQty, { type: "number", min: "2", required: true })}{field("bundlePrice", l.bundlePrice, { type: "number", step: "0.01", required: true })}</>}
        {kind === "LOT" && <>{field("maxQty", l.lotQty, { type: "number", min: "1", required: true })}{field("lotPrice", l.lotPrice, { type: "number", step: "0.01", required: true })}</>}
        {kind === "BEST_OFFER" && <>{field("floorPrice", l.floorPrice, { type: "number", step: "0.01" })}{field("minBidQty", l.minBidQty, { type: "number", min: "1" })}</>}
        {kind !== "LOT" && field("maxQty", l.maxQty, { type: "number", min: "1" })}
        {kind !== "LOT" && field("perBuyerMax", l.perBuyerMax, { type: "number", min: "1" })}
        {field("startsAt", l.startsAt, { type: "datetime-local", required: true })}
        {field("endsAt", l.endsAt, { type: "datetime-local", required: true })}
      </div>
      {kind === "VOLUME" && (
        <div className="space-y-2" data-testid="nd-tiers">
          <p className="text-sm font-medium">{l.tiers}</p>
          {tiers.map((t, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="space-y-1"><Label htmlFor={`tq-${i}`}>{l.fromQty}</Label><Input id={`tq-${i}`} type="number" min={1} value={t.minQty} onChange={(e) => setTiers(tiers.map((x, k) => (k === i ? { ...x, minQty: e.target.value } : x)))} className="h-9 w-24" /></div>
              <div className="space-y-1"><Label htmlFor={`tp-${i}`}>{l.unitPrice}</Label><Input id={`tp-${i}`} type="number" step="0.01" value={t.unitPrice} onChange={(e) => setTiers(tiers.map((x, k) => (k === i ? { ...x, unitPrice: e.target.value } : x)))} className="h-9 w-28" data-testid={`tier-price-${i}`} /></div>
              <Button type="button" size="sm" variant="ghost" onClick={() => setTiers(tiers.filter((_, k) => k !== i))} aria-label={l.remove}><X className="size-4" /></Button>
            </div>
          ))}
          {tiers.length < 6 && <Button type="button" size="sm" variant="outline" onClick={() => setTiers([...tiers, { minQty: "", unitPrice: "" }])}><Plus className="size-4" /> {l.addTier}</Button>}
        </div>
      )}
      {info && info.lots.length > 0 && (
        <div className="space-y-1"><Label htmlFor="nd-lot">{l.lot}</Label>
          <Select id="nd-lot" value={v.batchId} onChange={(e) => setV({ ...v, batchId: e.target.value })} data-testid="nd-lot"><option value="">{l.noLot}</option>{info.lots.map((x) => <option key={x.id} value={x.id}>{[x.lotCode, x.expiresOn ? f(l.bestBefore, { date: x.expiresOn }) : null, f(l.units, { n: x.units })].filter(Boolean).join(" · ")}</option>)}</Select>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">{field("title", l.titleLabel, { maxLength: 80, placeholder: l.titleHint })}{field("note", l.noteLabel, { maxLength: 200, placeholder: l.noteHint })}</div>
      <div className="flex flex-wrap items-center gap-2"><Button type="submit" disabled={pending || !offerId} data-testid="nd-submit"><Spin on={pending} icon={Plus} /> {l.submit}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function AnswerBid({ l, bidId, mine, list }: { l: L; bidId: string; mine: number; list: number }) {
  const { pending, error, run } = useRun();
  const [counter, setCounter] = useState(Math.round(((mine + list) / 2) * 100) / 100);
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-testid="answer-bid">
      <Button size="sm" disabled={pending} onClick={() => run(() => answerBidAction({ bidId, decision: "ACCEPT" }))} data-testid="bid-accept"><Check className="size-4" /> {l.accept}</Button>
      <Input type="number" step="0.01" aria-label={l.counter} value={counter} onChange={(e) => setCounter(Number(e.target.value))} className="h-8 w-24" data-testid="bid-counter-price" />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => answerBidAction({ bidId, decision: "COUNTER", counterPrice: counter }))} data-testid="bid-counter">{l.counter}</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => answerBidAction({ bidId, decision: "REJECT" }))} data-testid="bid-reject"><Ban className="size-4" /> {l.reject}</Button>
      <Msg error={error} />
    </span>
  );
}

export function CancelDeal({ l, id }: { l: L; id: string }) {
  const { pending, error, run } = useRun();
  return <span className="inline-flex items-center gap-1"><Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelDealAction({ id }))} data-testid="deal-cancel"><X className="size-4" /> {l.cancelDeal}</Button><Msg error={error} /></span>;
}
