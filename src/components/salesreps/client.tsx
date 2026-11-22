"use client";
/** Sales reps (Phase 62) — forms and buttons (texts passed in as `l`; FIRINGI's in English). */
import { useMemo, useRef, useState } from "react";
import { Ban, Camera, Check, CheckCircle2, LogIn, Minus, Plus, Save, Search, Send, ShoppingCart, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  addVisitPhotoAction, assignCustomerAction, cancelRepOrderAction, cancelVisitAction, checkInAction, decideRepOrderAction, finishVisitAction,
  planVisitAction, repProductsAction, saveRepAction, saveSalesRepSettingsAction, setAutoConfirmAction, takeOrderAction,
} from "@/server/actions/salesreps";
import type { SalesRepSettings } from "@/lib/sales-reps";

export type L = Record<string, string>;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const sel = "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm";
const money = (n: number, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);

// ── manager ─────────────────────────────────────────────────────────────────

export function RepForm({ l, candidates, rep }: { l: L; candidates?: { userId: string; name: string; email: string }[]; rep?: { userId: string; name: string; commissionPct: number; monthlyTarget: number | null; active: boolean } }) {
  const { pending, error, done, run } = useRun();
  const [open, setOpen] = useState(!rep);
  const [v, setV] = useState({ userId: rep?.userId ?? "", pct: String(rep?.commissionPct ?? 3), target: rep?.monthlyTarget == null ? "" : String(rep.monthlyTarget), active: rep?.active ?? true });
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="rep-edit">{l.edit}</Button>;
  if (!rep && !candidates?.length) return <p className="text-sm text-muted-foreground">{l.noCandidates}</p>;
  const save = () => run(() => saveRepAction({ userId: v.userId, commissionPct: Number(v.pct.replace(",", ".")), monthlyTarget: v.target.trim() ? Number(v.target.replace(",", ".")) : null, active: v.active }), () => { if (rep) setOpen(false); else setV({ ...v, userId: "" }); }, l.saved);
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid={rep ? "rep-edit-form" : "rep-add-form"}>
      {!rep && (
        <div className="min-w-0 flex-1 basis-56 space-y-1">
          <Label htmlFor="rep-user">{l.chooseUser}</Label>
          <select id="rep-user" className={sel} value={v.userId} onChange={(e) => setV({ ...v, userId: e.target.value })} data-testid="rep-user">
            <option value="">—</option>
            {candidates!.map((c) => <option key={c.userId} value={c.userId}>{c.name} · {c.email}</option>)}
          </select>
        </div>
      )}
      <div className="w-28 space-y-1"><Label htmlFor={`pct-${rep?.userId ?? "new"}`}>{l.commissionPct}</Label><Input id={`pct-${rep?.userId ?? "new"}`} inputMode="decimal" value={v.pct} onChange={(e) => setV({ ...v, pct: e.target.value })} data-testid="rep-pct" /></div>
      <div className="w-40 space-y-1"><Label htmlFor={`tg-${rep?.userId ?? "new"}`}>{l.target}</Label><Input id={`tg-${rep?.userId ?? "new"}`} inputMode="decimal" value={v.target} placeholder={l.noTarget} onChange={(e) => setV({ ...v, target: e.target.value })} data-testid="rep-target" /></div>
      {rep && <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} data-testid="rep-active" /> {l.active}</label>}
      <Button onClick={save} disabled={pending || !v.userId} data-testid="rep-save"><Spin on={pending} icon={Save} /> {l.save}</Button>
      {rep && <Button variant="ghost" onClick={() => setOpen(false)}>{l.cancel}</Button>}
      <Msg error={error} done={done} />
    </div>
  );
}

export function AssignRep({ l, buyerCompanyId, repId, reps }: { l: L; buyerCompanyId: string; repId: string | null; reps: { id: string; name: string }[] }) {
  const { pending, error, run } = useRun();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <select aria-label={l.rep} className={sel} value={repId ?? ""} disabled={pending} data-testid="assign-rep"
        onChange={(e) => run(() => assignCustomerAction({ buyerCompanyId, repId: e.target.value || null }))}>
        <option value="">{l.noRep}</option>
        {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      {pending && <Spin on icon={Check} />}
      <Msg error={error} />
    </div>
  );
}

/** Plan a visit — managers choose the rep; reps plan for themselves. */
export function PlanVisitForm({ l, reps, customers, date }: { l: L; reps?: { id: string; name: string; customers: { id: string; name: string }[] }[]; customers?: { id: string; name: string }[]; date: string }) {
  const { pending, error, done, run } = useRun();
  const [repId, setRepId] = useState(reps?.[0]?.id ?? "");
  const list = reps ? reps.find((r) => r.id === repId)?.customers ?? [] : customers ?? [];
  const [v, setV] = useState({ buyerCompanyId: "", date, note: "" });
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid="plan-visit">
      {reps && (
        <div className="min-w-0 flex-1 basis-40 space-y-1">
          <Label htmlFor="pv-rep">{l.rep}</Label>
          <select id="pv-rep" className={sel} value={repId} onChange={(e) => { setRepId(e.target.value); setV({ ...v, buyerCompanyId: "" }); }} data-testid="pv-rep">
            {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      )}
      <div className="min-w-0 flex-1 basis-48 space-y-1">
        <Label htmlFor="pv-customer">{l.customer}</Label>
        <select id="pv-customer" className={sel} value={v.buyerCompanyId} onChange={(e) => setV({ ...v, buyerCompanyId: e.target.value })} data-testid="pv-customer">
          <option value="">—</option>
          {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="w-40 space-y-1"><Label htmlFor="pv-date">{l.date}</Label><Input id="pv-date" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} data-testid="pv-date" /></div>
      <div className="min-w-0 flex-1 basis-48 space-y-1"><Label htmlFor="pv-note">{l.note}</Label><Input id="pv-note" maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
      <Button disabled={pending || !v.buyerCompanyId} data-testid="pv-save"
        onClick={() => run(() => planVisitAction({ ...v, repId: reps ? repId : null, note: v.note || null }), () => setV({ ...v, buyerCompanyId: "", note: "" }), l.planned)}>
        <Spin on={pending} icon={Plus} /> {l.plan}
      </Button>
      <Msg error={error} done={done} />
    </div>
  );
}

// ── the rep ─────────────────────────────────────────────────────────────────

function where(): Promise<{ latitude: number; longitude: number } | null> {
  return new Promise((res) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition((p) => res({ latitude: p.coords.latitude, longitude: p.coords.longitude }), () => res(null), { timeout: 6000, maximumAge: 120000 });
  });
}

export function CheckInButton({ l, buyerCompanyId, label, variant = "default" }: { l: L; buyerCompanyId: string; label?: string; variant?: "default" | "outline" }) {
  const { pending, error, run } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={variant} disabled={pending} title={l.checkInHint} data-testid="rep-checkin"
        onClick={() => run(async () => { const g = await where(); return checkInAction({ buyerCompanyId, latitude: g?.latitude ?? null, longitude: g?.longitude ?? null }); })}>
        <Spin on={pending} icon={LogIn} /> {label ?? l.checkIn}
      </Button>
      <Msg error={error} />
    </div>
  );
}

export function VisitActions({ l, id, buyerCompanyId, checkedIn, photos, maxPhotos }: { l: L; id: string; buyerCompanyId: string; checkedIn: boolean; photos: number; maxPhotos: number }) {
  const { pending, error, done, run } = useRun();
  const [finishing, setFinishing] = useState(false);
  const [v, setV] = useState({ outcome: "", note: "" });
  const file = useRef<HTMLInputElement>(null);
  const upload = (fl: File) => run(() => { const fd = new FormData(); fd.set("id", id); fd.set("file", fl); return addVisitPhotoAction(fd); });
  return (
    <div className="space-y-2" data-testid="visit-actions">
      <div className="flex flex-wrap gap-2">
        {!checkedIn && <CheckInButton l={l} buyerCompanyId={buyerCompanyId} />}
        <a href={`/vendor/reps/my-customers/${buyerCompanyId}?visit=${id}`} className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-sm hover:bg-muted" data-testid="visit-order"><ShoppingCart className="size-4" /> {l.takeOrder}</a>
        {!finishing && <Button size="sm" variant="outline" onClick={() => setFinishing(true)} data-testid="visit-finish-open"><CheckCircle2 className="size-4" /> {l.finish}</Button>}
        {maxPhotos > 0 && photos < maxPhotos && (
          <>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(e) => { const fl = e.target.files?.[0]; if (fl) upload(fl); e.target.value = ""; }} data-testid="visit-photo-input" />
            <Button size="sm" variant="outline" disabled={pending} onClick={() => file.current?.click()} title={f(l.maxPhotos, { n: maxPhotos })}><Spin on={pending} icon={Camera} /> {l.addPhoto}</Button>
          </>
        )}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelVisitAction({ id }))} data-testid="visit-cancel"><Ban className="size-4" /> {l.cancelVisit}</Button>
      </div>
      {finishing && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3" data-testid="visit-finish-form">
          <p className="text-sm font-medium">{l.howWent}</p>
          <div className="flex flex-wrap gap-2">
            {["ORDER", "NO_ORDER", "FOLLOW_UP", "CLOSED"].map((o) => (
              <button key={o} type="button" aria-pressed={v.outcome === o} onClick={() => setV({ ...v, outcome: o })} data-testid="visit-outcome" value={o}
                className="rounded-full border px-3 py-1 text-sm aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground">{l[`outcome.${o}`]}</button>
            ))}
          </div>
          <textarea rows={2} maxLength={1000} className="w-full rounded-md border bg-background p-2 text-sm" placeholder={l.note} aria-label={l.note} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} data-testid="visit-note" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending || !v.outcome} onClick={() => run(() => finishVisitAction({ id, outcome: v.outcome as "ORDER", note: v.note || null }), () => setFinishing(false), l.visitDone)} data-testid="visit-finish"><Spin on={pending} icon={Check} /> {l.save}</Button>
            <Button size="sm" variant="ghost" onClick={() => setFinishing(false)}>{l.cancel}</Button>
          </div>
        </div>
      )}
      <Msg error={error} done={done} />
    </div>
  );
}

type Product = { offerId: string; name: string; brand: string | null; packaging: string; sku: string; unitNet: number; available: number; minQty: number; step: number };
type Line = { offerId: string; name: string; packaging: string; unitNet: number; qty: number; step: number; minQty: number };

/** The rep takes an order at the customer's own prices. */
export function OrderTaker({ l, locale, buyerCompanyId, addresses, usual, auto, confirmHours, visitId }: {
  l: L; locale: string; buyerCompanyId: string; addresses: { id: string; label: string; text: string }[];
  usual: { offerId: string; name: string; packaging: string }[]; auto: boolean; confirmHours: number; visitId: string | null;
}) {
  const { pending, error, run } = useRun();
  const search = useRun();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Product[] | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [addressId, setAddressId] = useState(addresses[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ status: string; orderNumbers: string[]; error?: string | null } | null>(null);
  const total = useMemo(() => lines.reduce((a, x) => a + x.unitNet * x.qty, 0), [lines]);
  const find = (text: string) => search.run(() => repProductsAction({ buyerCompanyId, q: text }), (d) => setFound(d as Product[]));
  const add = (p: Product) => setLines((xs) => (xs.some((x) => x.offerId === p.offerId) ? xs.map((x) => (x.offerId === p.offerId ? { ...x, qty: x.qty + Math.max(1, p.step) } : x)) : [...xs, { offerId: p.offerId, name: p.name, packaging: p.packaging, unitNet: p.unitNet, qty: Math.max(p.minQty, p.step, 1), step: Math.max(1, p.step), minQty: Math.max(1, p.minQty) }]));
  const setQty = (id: string, qty: number) => setLines((xs) => xs.map((x) => (x.offerId === id ? { ...x, qty: Math.max(0, Math.floor(qty)) } : x)).filter((x) => x.qty > 0));
  const send = () => run(() => takeOrderAction({ buyerCompanyId, addressId, note: note || null, visitId, items: lines.map((x) => ({ offerId: x.offerId, qty: x.qty })) }),
    (d) => { setResult(d as { status: string; orderNumbers: string[]; error?: string | null }); setLines([]); setNote(""); });
  return (
    <div className="space-y-4" data-testid="order-taker">
      <p className="rounded-md bg-muted p-2 text-sm" data-testid="order-mode" data-auto={auto}>{auto ? l.autoOn : f(l.autoOff, { hours: confirmHours })}</p>
      {usual.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">{l.usual} <span className="font-normal text-muted-foreground">· {l.usualHint}</span></p>
          <div className="flex flex-wrap gap-2">
            {usual.map((u) => <button key={u.offerId} type="button" className="rounded-full border px-3 py-1 text-left text-sm hover:bg-muted" onClick={() => { setQ(u.name); find(u.name); }} data-testid="usual-item">{u.name} <span className="text-xs text-muted-foreground">{u.packaging}</span></button>)}
          </div>
        </div>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); find(q); }}>
        <Input placeholder={l.searchProducts} aria-label={l.searchProducts} value={q} onChange={(e) => setQ(e.target.value)} data-testid="rep-product-search" />
        <Button type="submit" variant="outline" disabled={search.pending}><Spin on={search.pending} icon={Search} /></Button>
      </form>
      <Msg error={search.error} />
      {found && (
        found.length === 0 ? <p className="text-sm text-muted-foreground">{l.noProducts}</p> : (
          <ul className="max-h-72 divide-y overflow-y-auto rounded-md border" data-testid="rep-products">
            {found.map((p) => (
              <li key={p.offerId} className="flex flex-wrap items-center gap-2 p-2 text-sm">
                <span className="min-w-0 flex-1 basis-48 break-words">{p.name} <span className="text-xs text-muted-foreground">· {p.packaging} · {p.sku}{p.minQty > 1 ? ` · ${f(l.minQty, { n: p.minQty })}` : ""} · {f(l.available, { n: p.available })}</span></span>
                <span className="tabular-nums">{money(p.unitNet, locale)}</span>
                <Button size="sm" variant="outline" onClick={() => add(p)} data-testid="rep-add-product"><Plus className="size-4" /> {l.add}</Button>
              </li>
            ))}
          </ul>
        )
      )}
      {lines.length > 0 && (
        <div className="space-y-3 rounded-lg border p-3" data-testid="rep-lines">
          {lines.map((x) => (
            <div key={x.offerId} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 basis-40 break-words">{x.name} <span className="text-xs text-muted-foreground">{x.packaging}</span></span>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="outline" className="size-8" aria-label="−" onClick={() => setQty(x.offerId, x.qty - x.step)}><Minus className="size-3" /></Button>
                <Input className="h-8 w-16 text-center" inputMode="numeric" aria-label={l.qty} value={x.qty} onChange={(e) => setQty(x.offerId, Number(e.target.value) || 0)} data-testid="rep-line-qty" />
                <Button size="icon" variant="outline" className="size-8" aria-label="+" onClick={() => setQty(x.offerId, x.qty + x.step)}><Plus className="size-3" /></Button>
              </div>
              <span className="w-24 text-right tabular-nums">{money(x.unitNet * x.qty, locale)}</span>
              <Button size="icon" variant="ghost" className="size-8" aria-label={l.remove} onClick={() => setQty(x.offerId, 0)}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <div className="flex justify-between border-t pt-2 text-sm font-semibold"><span>{l.total}</span><span className="tabular-nums" data-testid="rep-total">{money(total, locale)}</span></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ot-addr">{l.address}</Label>
              <select id="ot-addr" className={sel} value={addressId} onChange={(e) => setAddressId(e.target.value)}>{addresses.map((a) => <option key={a.id} value={a.id}>{a.text}</option>)}</select>
            </div>
            <div className="space-y-1"><Label htmlFor="ot-note">{l.orderNote}</Label><Input id="ot-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          </div>
          <p className="text-xs text-muted-foreground">{l.unitPricesNote}</p>
          <Button onClick={send} disabled={pending || !addressId} data-testid="rep-send"><Spin on={pending} icon={auto ? ShoppingCart : Send} /> {auto ? l.placeNow : l.send}</Button>
        </div>
      )}
      <Msg error={error} />
      {result && (
        <p className={`rounded-md p-2 text-sm ${result.status === "FAILED" ? "bg-destructive/10 text-destructive" : "bg-[color:var(--success,#16a34a)]/10"}`} role="status" data-testid="rep-result" data-status={result.status}>
          {result.status === "PENDING" ? l.sentToCustomer : result.status === "PLACED" ? f(l.placedOk, { numbers: result.orderNumbers.join(", ") }) : f(l.failed, { error: result.error ?? "" })}
        </p>
      )}
    </div>
  );
}

export function CancelRepOrder({ l, id }: { l: L; id: string }) {
  const { pending, error, run } = useRun();
  return <><Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelRepOrderAction({ id }))} data-testid="rep-order-cancel"><Spin on={pending} icon={Undo2} /> {l.cancelOrder}</Button><Msg error={error} /></>;
}

// ── the customer ────────────────────────────────────────────────────────────

export function DecideRepOrder({ l, id }: { l: L; id: string }) {
  const { pending, error, done, run } = useRun();
  const [res, setRes] = useState<{ status: string; orderNumbers: string[]; error?: string | null } | null>(null);
  if (res) return <p className="text-sm" role="status" data-testid="ro-result" data-status={res.status}>{res.status === "PLACED" ? f(l.placedOk, { numbers: res.orderNumbers.join(", ") }) : res.status === "REJECTED" ? l.rejected : f(l.failed, { error: res.error ?? "" })}</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={pending} onClick={() => run(() => decideRepOrderAction({ id, accept: true }), (d) => setRes(d as typeof res))} data-testid="ro-confirm"><Spin on={pending} icon={Check} /> {l.confirm}</Button>
      <Button variant="outline" disabled={pending} onClick={() => run(() => decideRepOrderAction({ id, accept: false }), (d) => setRes(d as typeof res))} data-testid="ro-reject"><X className="size-4" /> {l.reject}</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

export function AutoConfirmToggle({ l, vendorCompanyId, on, allowed }: { l: L; vendorCompanyId: string; on: boolean; allowed: boolean }) {
  const { pending, error, run } = useRun();
  return (
    <div className="space-y-1">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-4" checked={on} disabled={pending || (!allowed && !on)} data-testid="ro-auto"
          onChange={(e) => run(() => setAutoConfirmAction({ vendorCompanyId, on: e.target.checked }))} />
        <span>{l.autoConfirm}</span>
      </label>
      {!allowed && <p className="text-xs text-muted-foreground">{l.autoNotAllowed}</p>}
      <Msg error={error} />
    </div>
  );
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export function AdminSalesRepSettings({ settings }: { settings: SalesRepSettings }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(settings);
  const box = (k: "enabled" | "allowAutoConfirm", label: string) => (
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4" checked={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} data-testid={`srs-${k}`} /> <span>{label}</span></label>
  );
  return (
    <div className="space-y-3" data-testid="sr-settings">
      {box("enabled", "Sales reps are on (suppliers can add reps; reps can take orders)")}
      {box("allowAutoConfirm", "Customers may let a supplier's reps place orders without confirming each one")}
      <div className="flex flex-wrap gap-3">
        <div className="w-48 space-y-1"><Label htmlFor="srs-hours">Hours to confirm (1–168)</Label><Input id="srs-hours" type="number" min={1} max={168} value={v.confirmHours} onChange={(e) => setV({ ...v, confirmHours: Number(e.target.value) })} /></div>
        <div className="w-48 space-y-1"><Label htmlFor="srs-photos">Photos per visit (0–10)</Label><Input id="srs-photos" type="number" min={0} max={10} value={v.maxPhotos} onChange={(e) => setV({ ...v, maxPhotos: Number(e.target.value) })} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => run(() => saveSalesRepSettingsAction(v), undefined, "Saved")} disabled={pending} data-testid="srs-save"><Spin on={pending} icon={Save} /> Save</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}
