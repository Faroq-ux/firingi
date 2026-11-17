"use client";
/** Returnables & deposits (Phase 40) — interactive parts (texts passed in as `l`; FIRINGI admin parts are in English). */
import { useState } from "react";
import { Check, Gavel, Link2, Minus, PackageOpen, Plus, Save, Trash2, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  adjustBalanceAction, cancelPickupAction, collectPickupAction, confirmReturnAction, disputeReturnAction, dropOffAction, linkOfferAction, planPickupAction,
  requestPickupAction, resolveDisputeAction, saveReturnableSettingsAction, saveTypeAction, setCartSwapAction, unlinkOfferAction,
} from "@/server/actions/returnables";
import type { ReturnableSettings } from "@/lib/returnables";

export type L = Record<string, string>;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const fmt = (n: number, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
const int = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

/** − n + stepper (thumb-friendly). */
function Stepper({ value, onChange, label, testid, max }: { value: number; onChange: (n: number) => void; label: string; testid?: string; max?: number }) {
  return (
    <div className="flex items-center gap-1">
      <Button type="button" size="icon" variant="outline" className="size-9" aria-label={`− ${label}`} onClick={() => onChange(Math.max(0, value - 1))}><Minus className="size-4" /></Button>
      <Input type="number" inputMode="numeric" min={0} max={max} className="h-9 w-16 text-center" value={value} aria-label={label} onChange={(e) => onChange(int(e.target.value))} data-testid={testid} />
      <Button type="button" size="icon" variant="outline" className="size-9" aria-label={`+ ${label}`} onClick={() => onChange(value + 1)}><Plus className="size-4" /></Button>
    </div>
  );
}

// ── driver: empties at the stop / on a pickup ───────────────────────────────

export type StopItem = { typeId: string; code: string; name: string; kind: "DEPOSIT" | "EXCHANGE"; held: number; expected: number; fullOut: number };

/** Empties the driver takes back (one row per item the customer holds or the order carries). */
export function EmptiesCounter({ l, items, value, onChange }: { l: L; items: StopItem[]; value: Record<string, number>; onChange: (v: Record<string, number>) => void }) {
  if (!items.length) return null;
  return (
    <div className="space-y-2 rounded-xl border p-3" data-testid="empties-counter">
      <p className="flex items-center gap-2 text-sm font-medium"><PackageOpen className="size-4" /> {l.emptiesTaken}</p>
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.typeId} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="empties-row" data-type={i.code}>
            <div className="min-w-0 flex-1">
              <p className="break-words font-medium">{i.name}</p>
              <p className="text-xs text-muted-foreground">
                {f(l.customerHolds, { n: i.held })}
                {i.kind === "EXCHANGE" && i.fullOut > 0 ? ` · ${f(l.swapForFull, { n: i.fullOut })}` : ""}
                {i.expected > 0 ? ` · ${f(l.expectedBack, { n: i.expected })}` : ""}
              </p>
            </div>
            <Stepper value={value[i.typeId] ?? 0} onChange={(n) => onChange({ ...value, [i.typeId]: n })} label={i.name} testid={`empty-${i.code}`} />
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{l.emptiesHint}</p>
    </div>
  );
}

export function CollectPickupForm({ l, id, items }: { l: L; id: string; items: StopItem[] }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState<Record<string, number>>(Object.fromEntries(items.map((i) => [i.typeId, i.expected])));
  return (
    <div className="space-y-2">
      <EmptiesCounter l={l} items={items} value={v} onChange={setV} />
      <Button className="h-11 w-full" disabled={pending} onClick={() => run(() => collectPickupAction({ id, counted: v }), undefined, l.collected)} data-testid="pickup-collect"><Spin on={pending} icon={Truck} /> {l.markCollected}</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

// ── cart: deposits and swaps ────────────────────────────────────────────────

export type CartRet = { supplierId: string; supplier: string; typeId: string; code: string; name: string; kind: "DEPOSIT" | "EXCHANGE"; qtyOut: number; held: number; swap: number; charged: number; depositNet: number; depositTotal: number };

export function CartReturnables({ l, locale, lines, total }: { l: L; locale: string; lines: CartRet[]; total: number }) {
  const { pending, error, run } = useRun();
  const [swaps, setSwaps] = useState<Record<string, number>>(Object.fromEntries(lines.map((x) => [`${x.supplierId}:${x.typeId}`, x.swap])));
  const save = (x: CartRet, n: number) => {
    const q = Math.min(n, x.qtyOut);
    setSwaps((s) => ({ ...s, [`${x.supplierId}:${x.typeId}`]: q }));
    run(() => setCartSwapAction({ supplierId: x.supplierId, typeId: x.typeId, qty: q }));
  };
  return (
    <div className="space-y-3" data-testid="cart-returnables">
      <ul className="divide-y">
        {lines.map((x) => {
          const k = `${x.supplierId}:${x.typeId}`;
          return (
            <li key={k} className="space-y-2 py-2 text-sm" data-testid="cart-returnable" data-type={x.code}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="min-w-0 break-words font-medium">{x.qtyOut} × {x.name}</span>
                <span className="tabular-nums" data-testid="cart-deposit">{x.charged > 0 ? f(l.depositLine, { n: x.charged, price: fmt(x.depositNet, locale), total: fmt(x.depositTotal, locale) }) : l.noDeposit}</span>
              </div>
              {x.kind === "EXCHANGE" ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-2">
                  <div className="min-w-0 flex-1 text-xs"><p className="font-medium">{l.swapQuestion}</p><p className="text-muted-foreground">{f(l.youHold, { n: x.held })}</p></div>
                  <Stepper value={swaps[k] ?? 0} max={x.qtyOut} onChange={(n) => save(x, n)} label={l.swapQuestion} testid={`swap-${x.code}`} />
                </div>
              ) : <p className="text-xs text-muted-foreground">{l.depositRefund}</p>}
            </li>
          );
        })}
      </ul>
      <div className="flex justify-between border-t pt-2 text-sm font-medium"><span>{l.depositTotal}</span><span className="tabular-nums" data-testid="cart-deposit-total">{fmt(total, locale)}</span></div>
      <p className="text-xs text-muted-foreground">{l.depositCartHint}</p>
      {pending && <p className="text-xs text-muted-foreground">…</p>}
      <Msg error={error} />
    </div>
  );
}

// ── supplier: items, product links ──────────────────────────────────────────

export function TypeForm({ l, categories, admin }: { l: L; categories: readonly string[]; admin?: boolean }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ code: "", name: "", category: "CRATE", kind: "DEPOSIT" as "DEPOSIT" | "EXCHANGE", depositNet: "" });
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="type-form">
      <div className="space-y-1"><Label htmlFor="rt-name">{l.itemName}</Label><Input id="rt-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={l.itemNameHint} /></div>
      <div className="space-y-1"><Label htmlFor="rt-code">{l.itemCode}</Label><Input id="rt-code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} placeholder="KEG-20" /></div>
      <div className="space-y-1"><Label htmlFor="rt-cat">{l.category}</Label><Select id="rt-cat" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{categories.map((c) => <option key={c} value={c}>{l[`cat.${c}`] ?? c}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor="rt-kind">{l.kindLabel}</Label><Select id="rt-kind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as "DEPOSIT" | "EXCHANGE" })}><option value="DEPOSIT">{l["kind.DEPOSIT"]}</option><option value="EXCHANGE">{l["kind.EXCHANGE"]}</option></Select></div>
      <div className="space-y-1"><Label htmlFor="rt-dep">{l.depositPerUnit}</Label><Input id="rt-dep" type="number" inputMode="decimal" step="0.01" min={0} value={v.depositNet} onChange={(e) => setV({ ...v, depositNet: e.target.value })} /></div>
      <p className="self-end text-xs text-muted-foreground sm:pb-2">{v.kind === "EXCHANGE" ? l.kindExchangeHint : l.kindDepositHint}</p>
      <div className="sm:col-span-2">
        <Button disabled={pending || !v.name.trim() || !v.code.trim() || v.depositNet === ""} onClick={() => run(() => saveTypeAction({ code: v.code, name: v.name, category: v.category as never, kind: v.kind, depositNet: Number(v.depositNet) }), () => setV({ code: "", name: "", category: "CRATE", kind: "DEPOSIT", depositNet: "" }), admin ? "Saved." : l.saved)} data-testid="type-save"><Spin on={pending} icon={Plus} /> {l.addItem}</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function LinkForm({ l, offers, types }: { l: L; offers: { id: string; label: string }[]; types: { id: string; label: string }[] }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ offerId: offers[0]?.id ?? "", typeId: types[0]?.id ?? "", qty: 1 });
  if (!offers.length || !types.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-[2fr_2fr_auto_auto] sm:items-end" data-testid="link-form">
      <div className="min-w-0 space-y-1"><Label htmlFor="ln-offer">{l.product}</Label><Select id="ln-offer" value={v.offerId} onChange={(e) => setV({ ...v, offerId: e.target.value })}>{offers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></div>
      <div className="min-w-0 space-y-1"><Label htmlFor="ln-type">{l.comesWith}</Label><Select id="ln-type" value={v.typeId} onChange={(e) => setV({ ...v, typeId: e.target.value })}>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor="ln-qty">{l.perUnit}</Label><Input id="ln-qty" type="number" min={1} max={1000} className="w-24" value={v.qty} onChange={(e) => setV({ ...v, qty: Math.max(1, int(e.target.value)) })} /></div>
      <Button disabled={pending} onClick={() => run(() => linkOfferAction({ offerId: v.offerId, typeId: v.typeId, qtyPerUnit: v.qty }), undefined, l.saved)} data-testid="link-save"><Spin on={pending} icon={Link2} /> {l.link}</Button>
      <div className="sm:col-span-4"><Msg error={error} done={done} /></div>
    </div>
  );
}

export function UnlinkButton({ l, offerId, typeId }: { l: L; offerId: string; typeId: string }) {
  const { pending, error, run } = useRun();
  return <><Button size="sm" variant="ghost" disabled={pending} aria-label={l.unlink} onClick={() => run(() => unlinkOfferAction({ offerId, typeId }))} data-testid="unlink"><Spin on={pending} icon={Trash2} /></Button><Msg error={error} /></>;
}

// ── supplier: check returns, pickups, drop-offs, corrections ────────────────

export type RetLine = { typeId: string; code: string; name: string; counted: number; accepted: number | null; damaged: number; credited: number };

export function ConfirmReturnForm({ l, id, lines }: { l: L; id: string; lines: RetLine[] }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(Object.fromEntries(lines.map((x) => [x.typeId, { accepted: x.counted, damaged: 0 }])));
  const bad = lines.some((x) => v[x.typeId].accepted + v[x.typeId].damaged > x.counted);
  return (
    <div className="space-y-3" data-testid="confirm-return">
      <ul className="space-y-3">
        {lines.map((x) => (
          <li key={x.typeId} className="space-y-2 rounded-lg border p-3 text-sm" data-testid="confirm-line" data-type={x.code}>
            <p className="font-medium">{x.name} · {f(l.countedN, { n: x.counted })}</p>
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1"><Label>{l.accepted}</Label><Stepper value={v[x.typeId].accepted} max={x.counted} onChange={(n) => setV({ ...v, [x.typeId]: { ...v[x.typeId], accepted: n } })} label={l.accepted} testid={`accept-${x.code}`} /></div>
              <div className="space-y-1"><Label>{l.damaged}</Label><Stepper value={v[x.typeId].damaged} max={x.counted} onChange={(n) => setV({ ...v, [x.typeId]: { ...v[x.typeId], damaged: n } })} label={l.damaged} testid={`damaged-${x.code}`} /></div>
            </div>
            <p className="text-xs text-muted-foreground">{f(l.missingN, { n: Math.max(0, x.counted - v[x.typeId].accepted - v[x.typeId].damaged) })}</p>
          </li>
        ))}
      </ul>
      {bad && <p className="text-sm text-destructive">{l.tooMany}</p>}
      <Button disabled={pending || bad} onClick={() => run(() => confirmReturnAction({ id, lines: lines.map((x) => ({ typeId: x.typeId, ...v[x.typeId] })) }), undefined, l.checkedDone)} data-testid="confirm-return-save"><Spin on={pending} icon={Check} /> {l.confirmCheck}</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

export function PlanPickupForm({ l, id, drivers }: { l: L; id: string; drivers: { id: string; name: string }[] }) {
  const { pending, error, run } = useRun();
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const [v, setV] = useState({ driverId: drivers[0]?.id ?? "", date: tomorrow });
  if (!drivers.length) return <p className="text-xs text-muted-foreground">{l.noDrivers}</p>;
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="plan-pickup">
      <div className="min-w-0 space-y-1"><Label htmlFor={`pd-${id}`}>{l.driver}</Label><Select id={`pd-${id}`} value={v.driverId} onChange={(e) => setV({ ...v, driverId: e.target.value })}>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor={`pt-${id}`}>{l.date}</Label><Input id={`pt-${id}`} type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></div>
      <Button size="sm" disabled={pending} onClick={() => run(() => planPickupAction({ id, driverId: v.driverId, plannedDate: v.date }))} data-testid="plan-pickup-save"><Spin on={pending} icon={Truck} /> {l.plan}</Button>
      <Msg error={error} />
    </div>
  );
}

export function CancelPickup({ l, id }: { l: L; id: string }) {
  const { pending, error, run } = useRun();
  return <><Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelPickupAction({ id }))} data-testid="cancel-pickup"><Spin on={pending} icon={X} /> {l.cancel}</Button><Msg error={error} /></>;
}

type Opt = { id: string; label: string };
export function DropOffForm({ l, customers, types }: { l: L; customers: Opt[]; types: Opt[] }) {
  const { pending, error, done, run } = useRun();
  const [customerId, setCustomer] = useState(customers[0]?.id ?? "");
  const [v, setV] = useState<Record<string, { accepted: number; damaged: number }>>({});
  const [note, setNote] = useState("");
  if (!customers.length) return <p className="text-sm text-muted-foreground">{l.noCustomersYet}</p>;
  const lines = Object.entries(v).filter(([, x]) => x.accepted + x.damaged > 0).map(([typeId, x]) => ({ typeId, ...x }));
  return (
    <div className="space-y-3" data-testid="dropoff-form">
      <div className="space-y-1"><Label htmlFor="do-cust">{l.customer}</Label><Select id="do-cust" value={customerId} onChange={(e) => setCustomer(e.target.value)}>{customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></div>
      <ul className="space-y-2">
        {types.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1 break-words">{t.label}</span>
            <span className="flex items-center gap-1 text-xs">{l.accepted} <Stepper value={v[t.id]?.accepted ?? 0} onChange={(n) => setV({ ...v, [t.id]: { accepted: n, damaged: v[t.id]?.damaged ?? 0 } })} label={`${t.label} ${l.accepted}`} /></span>
            <span className="flex items-center gap-1 text-xs">{l.damaged} <Stepper value={v[t.id]?.damaged ?? 0} onChange={(n) => setV({ ...v, [t.id]: { accepted: v[t.id]?.accepted ?? 0, damaged: n } })} label={`${t.label} ${l.damaged}`} /></span>
          </li>
        ))}
      </ul>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={l.noteOptional} />
      <Button disabled={pending || !lines.length} onClick={() => run(() => dropOffAction({ customerId, lines, note: note || null }), () => { setV({}); setNote(""); }, l.dropOffDone)} data-testid="dropoff-save"><Spin on={pending} icon={Check} /> {l.recordDropOff}</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

export function AdjustForm({ l, customers, types }: { l: L; customers: Opt[]; types: Opt[] }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ customerId: customers[0]?.id ?? "", typeId: types[0]?.id ?? "", qty: "", note: "" });
  if (!customers.length || !types.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="adjust-form">
      <div className="space-y-1"><Label htmlFor="ad-cust">{l.customer}</Label><Select id="ad-cust" value={v.customerId} onChange={(e) => setV({ ...v, customerId: e.target.value })}>{customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor="ad-type">{l.item}</Label><Select id="ad-type" value={v.typeId} onChange={(e) => setV({ ...v, typeId: e.target.value })}>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor="ad-qty">{l.adjustQty}</Label><Input id="ad-qty" type="number" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} placeholder="+5 / −2" /></div>
      <div className="space-y-1"><Label htmlFor="ad-note">{l.reason}</Label><Input id="ad-note" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder={l.openingBalance} /></div>
      <div className="sm:col-span-2"><Button variant="outline" disabled={pending || !Number(v.qty) || v.note.trim().length < 3} onClick={() => run(() => adjustBalanceAction({ customerId: v.customerId, typeId: v.typeId, qty: Math.round(Number(v.qty)), note: v.note }), () => setV({ ...v, qty: "", note: "" }), l.saved)} data-testid="adjust-save"><Spin on={pending} icon={Save} /> {l.saveCorrection}</Button><Msg error={error} done={done} /></div>
    </div>
  );
}

// ── customer: pickups, disputes ─────────────────────────────────────────────

export function PickupRequestForm({ l, suppliers, addresses, min }: { l: L; suppliers: { id: string; name: string; items: { typeId: string; name: string; held: number }[] }[]; addresses: Opt[]; min: number }) {
  const { pending, error, done, run } = useRun();
  const [supplierId, setSupplier] = useState(suppliers[0]?.id ?? "");
  const [addressId, setAddress] = useState(addresses[0]?.id ?? "");
  const [v, setV] = useState<Record<string, number>>({});
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const s = suppliers.find((x) => x.id === supplierId);
  if (!suppliers.length) return <p className="text-sm text-muted-foreground">{l.nothingToCollect}</p>;
  const lines = Object.entries(v).filter(([, n]) => n > 0).map(([typeId, qty]) => ({ typeId, qty }));
  const total = lines.reduce((a, x) => a + x.qty, 0);
  return (
    <div className="space-y-3" data-testid="pickup-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="pk-sup">{l.supplier}</Label><Select id="pk-sup" value={supplierId} onChange={(e) => { setSupplier(e.target.value); setV({}); }}>{suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></div>
        <div className="space-y-1"><Label htmlFor="pk-addr">{l.collectFrom}</Label><Select id="pk-addr" value={addressId} onChange={(e) => setAddress(e.target.value)}>{addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></div>
      </div>
      <ul className="space-y-2">
        {s?.items.map((i) => (
          <li key={i.typeId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1 break-words">{i.name} <span className="text-xs text-muted-foreground">· {f(l.youHold, { n: i.held })}</span></span>
            <Stepper value={v[i.typeId] ?? 0} max={i.held} onChange={(n) => setV({ ...v, [i.typeId]: Math.min(n, i.held) })} label={i.name} testid={`pickup-qty-${i.typeId}`} />
          </li>
        ))}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="pk-date">{l.preferredDate}</Label><Input id="pk-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="pk-note">{l.noteOptional}</Label><Input id="pk-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      {total > 0 && total < min && <p className="text-xs text-muted-foreground">{f(l.minPickup, { n: min })}</p>}
      <Button disabled={pending || total < Math.max(1, min) || !addressId} onClick={() => run(() => requestPickupAction({ supplierId, addressId, lines, note: note || null, preferredDate: date || null }), () => { setV({}); setNote(""); setDate(""); }, l.pickupRequested)} data-testid="pickup-request"><Spin on={pending} icon={Truck} /> {l.requestPickup}</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

export function DisputeForm({ l, id }: { l: L; id: string }) {
  const { pending, error, done, run } = useRun();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open) return <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="dispute-open"><Gavel className="size-4" /> {l.contest}</Button>;
  return (
    <div className="space-y-2" data-testid="dispute-form">
      <Label htmlFor="dp-note">{l.contestWhy}</Label>
      <Input id="dp-note" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2"><Button size="sm" disabled={pending || note.trim().length < 5} onClick={() => run(() => disputeReturnAction({ id, note }), () => setOpen(false), l.contested)} data-testid="dispute-send"><Spin on={pending} icon={Gavel} /> {l.send}</Button><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{l.cancel}</Button></div>
      <Msg error={error} done={done} />
    </div>
  );
}

// ── FIRINGI (English) ───────────────────────────────────────────────────────

export function ResolveForm({ id }: { id: string }) {
  const { pending, error, done, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2" data-testid="resolve-form">
      <Label htmlFor="rs-note">Decision note (both sides see it)</Label>
      <Input id="rs-note" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending || note.trim().length < 3} onClick={() => run(() => resolveDisputeAction({ id, decision: "CUSTOMER", note }), undefined, "Decided: customer's count.")} data-testid="resolve-customer"><Spin on={pending} icon={Check} /> Customer&apos;s count (refund the difference)</Button>
        <Button size="sm" variant="outline" disabled={pending || note.trim().length < 3} onClick={() => run(() => resolveDisputeAction({ id, decision: "SUPPLIER", note }), undefined, "Decided: supplier's count.")} data-testid="resolve-supplier"><X className="size-4" /> Supplier&apos;s count stands</Button>
      </div>
      <Msg error={error} done={done} />
    </div>
  );
}

export function SettingsForm({ initial, countries, suppliers }: { initial: ReturnableSettings; countries: { code: string; name: string }[]; suppliers: Opt[] }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState<ReturnableSettings>(initial);
  const [sup, setSup] = useState({ id: suppliers[0]?.id ?? "", days: 60, action: "KEEP" as "KEEP" | "REMIND" });
  const vat = (code: string) => s.vat[code] ?? { mode: "PRODUCT" as const };
  return (
    <div className="space-y-6" data-testid="rt-settings">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> Returnables & deposits on</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.creditDamaged} onChange={(e) => setS({ ...s, creditDamaged: e.target.checked })} /> Refund damaged empties too</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.pickups} onChange={(e) => setS({ ...s, pickups: e.target.checked })} /> Customers can ask for a pickup</label>
        <div className="space-y-1"><Label htmlFor="st-min">Smallest pickup (units)</Label><Input id="st-min" type="number" min={1} value={s.pickupMinUnits} onChange={(e) => setS({ ...s, pickupMinUnits: Math.max(1, int(e.target.value)) })} /></div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Empties held too long</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1"><Label htmlFor="st-days">After (days)</Label><Input id="st-days" type="number" min={7} max={730} value={s.overdue.days} onChange={(e) => setS({ ...s, overdue: { ...s.overdue, days: int(e.target.value) } })} data-testid="st-days" /></div>
          <div className="space-y-1"><Label htmlFor="st-action">Then</Label><Select id="st-action" value={s.overdue.action} onChange={(e) => setS({ ...s, overdue: { ...s.overdue, action: e.target.value as "KEEP" | "REMIND" } })} data-testid="st-action"><option value="REMIND">Keep an open balance and remind the customer</option><option value="KEEP">Keep the deposit as the price (no refund after)</option></Select></div>
          <div className="space-y-1"><Label htmlFor="st-every">Remind every (days)</Label><Input id="st-every" type="number" min={1} max={90} value={s.overdue.remindEveryDays} onChange={(e) => setS({ ...s, overdue: { ...s.overdue, remindEveryDays: int(e.target.value) } })} /></div>
        </div>
        <p className="text-sm font-medium">Exceptions per supplier</p>
        <ul className="space-y-1 text-sm">
          {Object.entries(s.suppliers).map(([id, r]) => (
            <li key={id} className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1">{suppliers.find((x) => x.id === id)?.label ?? id}: {r.days} days → {r.action === "KEEP" ? "keep deposit" : "remind"}</span>
              <Button size="sm" variant="ghost" onClick={() => { const n = { ...s.suppliers }; delete n[id]; setS({ ...s, suppliers: n }); }}><Trash2 className="size-4" /></Button></li>
          ))}
        </ul>
        {suppliers.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <Select aria-label="Supplier" value={sup.id} onChange={(e) => setSup({ ...sup, id: e.target.value })}>{suppliers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select>
            <Input aria-label="Days" type="number" className="w-24" value={sup.days} onChange={(e) => setSup({ ...sup, days: int(e.target.value) })} />
            <Select aria-label="Action" value={sup.action} onChange={(e) => setSup({ ...sup, action: e.target.value as "KEEP" | "REMIND" })}><option value="KEEP">keep deposit</option><option value="REMIND">remind</option></Select>
            <Button size="sm" variant="outline" onClick={() => setS({ ...s, suppliers: { ...s.suppliers, [sup.id]: { days: sup.days, action: sup.action } } })}><Plus className="size-4" /> Add</Button>
          </div>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">VAT on deposits, per country</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {countries.map((c) => (
            <li key={c.code} className="flex flex-wrap items-center gap-2 text-sm" data-testid="vat-row" data-country={c.code}>
              <span className="w-28 shrink-0">{c.name}</span>
              <Select aria-label={`${c.name} deposit VAT`} value={vat(c.code).mode} onChange={(e) => setS({ ...s, vat: { ...s.vat, [c.code]: { mode: e.target.value as "NONE" | "PRODUCT" | "FIXED", rate: vat(c.code).rate } } })}>
                <option value="NONE">No VAT</option><option value="PRODUCT">Same as the goods</option><option value="FIXED">Fixed rate</option>
              </Select>
              {vat(c.code).mode === "FIXED" && <Input aria-label={`${c.name} rate`} type="number" className="w-20" value={vat(c.code).rate ?? 0} onChange={(e) => setS({ ...s, vat: { ...s.vat, [c.code]: { mode: "FIXED", rate: Number(e.target.value) } } })} />}
            </li>
          ))}
        </ul>
      </div>
      <Button disabled={pending} onClick={() => run(() => saveReturnableSettingsAction(s), undefined, "Settings saved.")} data-testid="rt-settings-save"><Spin on={pending} icon={Save} /> Save settings</Button>
      <Msg error={error} done={done} />
    </div>
  );
}
