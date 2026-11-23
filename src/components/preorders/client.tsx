"use client";
/** Pre-orders & price locks (Phase 71) — the customer's forms: pre-order, cancel, accept / decline, ask for a lock, call off. */
import { useState } from "react";
import { CalendarCheck, Check, Lock, Save, ShoppingCart, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { answerAllocationAction, callOffAction, cancelLockAction, cancelPreorderAction, placePreorderAction, requestLockAction } from "@/server/actions/preorders";

type L = Record<string, string>;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
type Addr = { id: string; label: string };

export function PreorderForm({ l, campaignId, items, dates, addresses, initial }: {
  l: L; campaignId: string; items: { id: string; product: string; pack: string; minQty: number; maxQty: number | null }[];
  dates: { value: string; label: string }[]; addresses: Addr[];
  initial?: { addressId: string; deliveryDate: string; lines: Record<string, number> } | null;
}) {
  const { pending, error, done, run } = useRun();
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(items.map((i) => [i.id, initial?.lines[i.id] ? String(initial.lines[i.id]) : ""])));
  const [date, setDate] = useState(initial?.deliveryDate ?? dates[0]?.value ?? "");
  const [addr, setAddr] = useState(initial?.addressId ?? addresses[0]?.id ?? "");
  const [pay, setPay] = useState<string | null>(null);
  return (
    <form className="space-y-3" data-testid="po-form" onSubmit={(e) => {
      e.preventDefault();
      run(() => placePreorderAction({ input: { campaignId, addressId: addr, deliveryDate: date, lines: items.map((i) => ({ itemId: i.id, qty: Number(qty[i.id] || 0) })) } }), (d) => setPay((d as { payLink: string | null }).payLink), initial ? l.updated : l.placed);
    }}>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((i) => (
          <div key={i.id} className="space-y-1">
            <Label htmlFor={`po-${i.id}`} className="text-xs">{i.product} · {i.pack}</Label>
            <Input id={`po-${i.id}`} type="number" inputMode="numeric" min={0} max={i.maxQty ?? undefined} placeholder={i.maxQty ? f(l.limitsMax, { min: i.minQty, max: i.maxQty }) : f(l.limits, { min: i.minQty })} value={qty[i.id]} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} data-testid="po-qty" />
          </div>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor={`pd-${campaignId}`} className="text-xs">{l.deliveryDate}</Label><Select id={`pd-${campaignId}`} value={date} onChange={(e) => setDate(e.target.value)} data-testid="po-date">{dates.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</Select></div>
        <div className="space-y-1"><Label htmlFor={`pa-${campaignId}`} className="text-xs">{l.address}</Label><Select id={`pa-${campaignId}`} value={addr} onChange={(e) => setAddr(e.target.value)} data-testid="po-address">{addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} data-testid="po-submit"><Spin on={pending} icon={initial ? Save : CalendarCheck} /> {initial ? l.update : l.preorder}</Button>
        {pay && <a className="text-sm font-medium text-primary underline" href={pay} data-testid="po-pay">{l.payDeposit} →</a>}
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

export function ReservationActions({ l, id, canCancel, needsAnswer }: { l: L; id: string; canCancel: boolean; needsAnswer: boolean }) {
  const { pending, error, run } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {needsAnswer && <>
        <Button size="sm" disabled={pending} onClick={() => run(() => answerAllocationAction({ id, accept: true }))} data-testid="po-accept"><Spin on={pending} icon={Check} /> {l.accept}</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => answerAllocationAction({ id, accept: false }))} data-testid="po-decline"><X className="size-4" /> {l.decline}</Button>
      </>}
      {canCancel && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelPreorderAction({ id }))} data-testid="po-cancel"><X className="size-4" /> {l.cancel}</Button>}
      <Msg error={error} />
    </div>
  );
}

export function LockRequest({ l, offerId, perMonth, maxMonths }: { l: L; offerId: string; perMonth: number; maxMonths: number }) {
  const { pending, error, done, run } = useRun();
  const [months, setMonths] = useState("3");
  const [qty, setQty] = useState(String(Math.max(1, perMonth * 3)));
  return (
    <form className="flex flex-wrap items-end gap-2" data-testid="pl-form" onSubmit={(e) => { e.preventDefault(); run(() => requestLockAction({ input: { offerId, qty: Number(qty), months: Number(months) } }), undefined, l.lockRequested); }}>
      <div className="space-y-1"><Label className="text-xs" htmlFor={`lq-${offerId}`}>{l.qty}</Label><Input id={`lq-${offerId}`} type="number" min={1} className="h-9 w-24" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="pl-qty" /></div>
      <div className="space-y-1"><Label className="text-xs" htmlFor={`lm-${offerId}`}>{l.months}</Label><Select id={`lm-${offerId}`} className="h-9 w-20" value={months} onChange={(e) => setMonths(e.target.value)} data-testid="pl-months">{Array.from({ length: maxMonths }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}</option>)}</Select></div>
      <Button type="submit" size="sm" disabled={pending} data-testid="pl-request"><Spin on={pending} icon={Lock} /> {l.lockFor}</Button>
      <Msg error={error} done={done} />
    </form>
  );
}

export function CallOff({ l, id, left, perMonth, addresses }: { l: L; id: string; left: number; perMonth: number; addresses: Addr[] }) {
  const { pending, error, done, run } = useRun();
  const [qty, setQty] = useState(String(Math.max(1, Math.min(left, perMonth || 1))));
  const [addr, setAddr] = useState(addresses[0]?.id ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form className="flex flex-wrap items-end gap-2" data-testid="pl-calloff" onSubmit={(e) => { e.preventDefault(); run(() => callOffAction({ input: { id, qty: Number(qty), addressId: addr } }), (d) => setMsg(f(l.callOffDone, { number: (d as { order: { number: string } }).order.number }))); }}>
      <div className="space-y-1"><Label className="text-xs" htmlFor={`cq-${id}`}>{l.qty}</Label><Input id={`cq-${id}`} type="number" min={1} max={left} className="h-9 w-24" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="pl-calloff-qty" /></div>
      <div className="min-w-0 flex-1 basis-48 space-y-1"><Label className="text-xs" htmlFor={`ca-${id}`}>{l.address}</Label><Select id={`ca-${id}`} className="h-9" value={addr} onChange={(e) => setAddr(e.target.value)}>{addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></div>
      <Button type="submit" size="sm" disabled={pending} data-testid="pl-calloff-submit"><Spin on={pending} icon={ShoppingCart} /> {l.callOff}</Button>
      <Msg error={error} done={msg ?? done} />
    </form>
  );
}

export function LockCancel({ l, id }: { l: L; id: string }) {
  const { pending, error, run } = useRun();
  return <span className="inline-flex items-center gap-1"><Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelLockAction({ id }))} data-testid="pl-cancel"><X className="size-4" /> {l.cancel}</Button><Msg error={error} /></span>;
}
