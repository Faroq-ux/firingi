"use client";
/** Consignment stock (Phase 65) — forms (texts passed in as `l`; FIRINGI's in English). */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, ClipboardCheck, PackageCheck, Plus, RotateCcw, Save, Search, Send, Trash2, Undo2, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  closeSiteAction, consignmentCustomersAction, createSiteAction, decideCountAction, decideSiteAction, pickUpAction, receiveShipmentAction, retryCountAction,
  saveConsignmentSettingsAction, searchConsignmentVendorsAction, sendStockAction, setVendorConsignmentAction, shippableAction, submitCountAction, updateSiteAction,
} from "@/server/actions/consignment";
import type { ConsignmentSettings } from "@/lib/consignment";

export type L = Record<string, string>;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const sel = "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm";
const COUNTERS = ["EITHER", "CUSTOMER", "SUPPLIER"] as const;
type Counter = (typeof COUNTERS)[number];
type Line = { offerId: string; name: string; max: number };

/** One number per product (count, receipt, pick-up). */
function QtyRows({ l, lines, value, onChange, label, testid }: { l: L; lines: Line[]; value: Record<string, string>; onChange: (v: Record<string, string>) => void; label: string; testid: string }) {
  return (
    <ul className="divide-y rounded-md border">
      {lines.map((x) => (
        <li key={x.offerId} className="flex flex-wrap items-center gap-2 p-2 text-sm" data-testid={`${testid}-row`} data-offer={x.offerId}>
          <span className="min-w-0 flex-1 basis-40 break-words">{x.name} <span className="text-xs text-muted-foreground">· {l.expected}: {x.max}</span></span>
          <Input type="number" inputMode="numeric" min={0} max={x.max} className="w-24" aria-label={`${label} · ${x.name}`} value={value[x.offerId] ?? ""} onChange={(e) => onChange({ ...value, [x.offerId]: e.target.value })} data-testid={`${testid}-qty`} />
        </li>
      ))}
    </ul>
  );
}
const toQty = (v: Record<string, string>, lines: Line[], fallback: "max" | "zero" | "skip") =>
  Object.fromEntries(lines.flatMap((x) => {
    const raw = v[x.offerId];
    if (raw == null || raw === "") return fallback === "skip" ? [] : [[x.offerId, fallback === "max" ? x.max : 0]];
    return [[x.offerId, Math.max(0, Math.floor(Number(raw)) || 0)]];
  }));

// ── supplier ────────────────────────────────────────────────────────────────

type Cust = { id: string; name: string; taxId: string; addresses: { id: string; label: string }[] };
export function NewSite({ l, warehouses, every, approval }: { l: L; warehouses: { id: string; name: string }[]; every: number; approval: boolean }) {
  const s = useRun(), find = useRun();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Cust[] | null>(null);
  const [cust, setCust] = useState<Cust | null>(null);
  const [v, setV] = useState({ addressId: "", warehouseId: warehouses[0]?.id ?? "", countEveryDays: every, counter: "EITHER" as Counter, note: "" });
  return (
    <div className="space-y-3" data-testid="cs-new">
      <p className="text-sm text-muted-foreground">{l.newSiteHint}{approval ? ` ${l.newSiteApproval}` : ""}</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); find.run(() => consignmentCustomersAction({ q }), (d) => setFound(d as Cust[])); }}>
        <Input placeholder={l.searchCustomer} aria-label={l.searchCustomer} value={q} onChange={(e) => setQ(e.target.value)} data-testid="cs-customer-search" />
        <Button type="submit" variant="outline" disabled={find.pending} aria-label={l.searchCustomer}><Spin on={find.pending} icon={Search} /></Button>
      </form>
      <Msg error={find.error} />
      {found && !cust && (found.length === 0 ? <p className="text-sm text-muted-foreground">{l.noCustomers}</p> : (
        <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
          {found.map((c) => <li key={c.id}><button type="button" className="w-full p-2 text-left text-sm hover:bg-muted" onClick={() => { setCust(c); setV({ ...v, addressId: c.addresses[0]?.id ?? "" }); }} data-testid="cs-pick-customer">{c.name} <span className="text-xs text-muted-foreground">· {c.taxId}</span></button></li>)}
        </ul>
      ))}
      {cust && (
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="cs-customer-chosen"><Check className="size-4" /> <span className="min-w-0 break-words font-medium">{cust.name}</span>
            <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={l.remove} onClick={() => setCust(null)}><X className="size-4" /></button></p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="cs-addr">{l.address}</Label>
              <select id="cs-addr" className={sel} value={v.addressId} onChange={(e) => setV({ ...v, addressId: e.target.value })} data-testid="cs-address">{cust.addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></div>
            <div className="space-y-1"><Label htmlFor="cs-wh">{l.warehouse}</Label>
              <select id="cs-wh" className={sel} value={v.warehouseId} onChange={(e) => setV({ ...v, warehouseId: e.target.value })} data-testid="cs-warehouse">{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
            <div className="space-y-1"><Label htmlFor="cs-every">{l.countEvery}</Label>
              <Input id="cs-every" type="number" min={1} max={90} value={v.countEveryDays} onChange={(e) => setV({ ...v, countEveryDays: Number(e.target.value) })} data-testid="cs-every" /></div>
            <div className="space-y-1"><Label htmlFor="cs-counter">{l.counter}</Label>
              <select id="cs-counter" className={sel} value={v.counter} onChange={(e) => setV({ ...v, counter: e.target.value as Counter })} data-testid="cs-counter">{COUNTERS.map((c) => <option key={c} value={c}>{l[`counterKind.${c}`]}</option>)}</select></div>
          </div>
          <div className="space-y-1"><Label htmlFor="cs-note">{l.note}</Label><Input id="cs-note" maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={s.pending || !v.addressId || !v.warehouseId} onClick={() => s.run(() => createSiteAction({ buyerCompanyId: cust.id, ...v, note: v.note || null }), (d) => router.push(`/vendor/consignment/${(d as { id: string }).id}`))} data-testid="cs-create">
              <Spin on={s.pending} icon={Plus} /> {l.create}
            </Button>
            <Msg error={s.error} />
          </div>
        </div>
      )}
    </div>
  );
}

type Prod = { offerId: string; name: string; packaging: string; sku: string; free: number };
export function SendStock({ l, siteId }: { l: L; siteId: string }) {
  const s = useRun(), find = useRun();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Prod[] | null>(null);
  const [items, setItems] = useState<(Prod & { qty: number })[]>([]);
  const [ok, setOk] = useState<string | null>(null);
  return (
    <div className="space-y-3" data-testid="cs-send">
      <p className="text-sm text-muted-foreground">{l.sendHint}</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); find.run(() => shippableAction({ id: siteId, q }), (d) => setFound(d as Prod[])); }}>
        <Input placeholder={l.searchProduct} aria-label={l.searchProduct} value={q} onChange={(e) => setQ(e.target.value)} data-testid="cs-product-search" />
        <Button type="submit" variant="outline" disabled={find.pending} aria-label={l.searchProduct}><Spin on={find.pending} icon={Search} /></Button>
      </form>
      <Msg error={find.error} />
      {found && (
        <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
          {found.map((p) => (
            <li key={p.offerId} className="flex flex-wrap items-center gap-2 p-2 text-sm">
              <span className="min-w-0 flex-1 basis-40 break-words">{p.name} <span className="text-xs text-muted-foreground">· {p.packaging} · {p.sku} · {f(l.free, { n: p.free })}</span></span>
              <Button size="sm" variant="outline" disabled={items.some((i) => i.offerId === p.offerId)} onClick={() => setItems([...items, { ...p, qty: 1 }])} data-testid="cs-add-product" aria-label={`${l.sendNow} · ${p.name}`}><Plus className="size-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <ul className="divide-y rounded-md border" data-testid="cs-send-lines">
          {items.map((i) => (
            <li key={i.offerId} className="flex flex-wrap items-center gap-2 p-2 text-sm">
              <span className="min-w-0 flex-1 basis-40 break-words">{i.name}</span>
              <Input type="number" min={1} max={i.free} className="w-24" aria-label={`${l.qty} · ${i.name}`} value={i.qty} onChange={(e) => setItems(items.map((x) => (x.offerId === i.offerId ? { ...x, qty: Number(e.target.value) } : x)))} data-testid="cs-send-qty" />
              <Button size="sm" variant="ghost" aria-label={l.remove} onClick={() => setItems(items.filter((x) => x.offerId !== i.offerId))}><Trash2 className="size-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={s.pending || !items.length} onClick={() => s.run(() => sendStockAction({ id: siteId, items: items.map((i) => ({ offerId: i.offerId, qty: Math.floor(i.qty) })) }), (d) => { setOk(f(l.sentOk, { number: (d as { number: string }).number })); setItems([]); setFound(null); })} data-testid="cs-send-go">
          <Spin on={s.pending} icon={Send} /> {l.sendNow}
        </Button>
        {ok && <span className="text-sm" role="status" data-testid="cs-sent-ok">{ok}</span>}
        <Msg error={s.error} />
      </div>
    </div>
  );
}

export function PickUp({ l, siteId, lines, warehouse }: { l: L; siteId: string; lines: Line[]; warehouse: string }) {
  const s = useRun();
  const [v, setV] = useState<Record<string, string>>({});
  const [ok, setOk] = useState<string | null>(null);
  return (
    <div className="space-y-3" data-testid="cs-pickup">
      <p className="text-sm text-muted-foreground">{f(l.pickUpHint, { warehouse })}</p>
      <QtyRows l={l} lines={lines} value={v} onChange={setV} label={l.takeBack} testid="cs-pickup" />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={s.pending} onClick={() => s.run(() => pickUpAction({ id: siteId, back: toQty(v, lines, "skip") }), (d) => { setOk(f(l.tookBack, { n: (d as { units: number }).units })); setV({}); })} data-testid="cs-pickup-go">
          <Spin on={s.pending} icon={Undo2} /> {l.takeBack}
        </Button>
        {ok && <span className="text-sm" role="status">{ok}</span>}
        <Msg error={s.error} />
      </div>
    </div>
  );
}

export function SiteSettings({ l, siteId, value, canClose, status }: { l: L; siteId: string; value: { countEveryDays: number; counter: Counter; note: string | null }; canClose: boolean; status: string }) {
  const s = useRun(), c = useRun();
  const [v, setV] = useState({ ...value, note: value.note ?? "" });
  return (
    <div className="space-y-3" data-testid="cs-site-settings">
      {status === "ACTIVE" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="css-every">{l.countEvery}</Label><Input id="css-every" type="number" min={1} max={90} value={v.countEveryDays} onChange={(e) => setV({ ...v, countEveryDays: Number(e.target.value) })} /></div>
            <div className="space-y-1"><Label htmlFor="css-counter">{l.counter}</Label>
              <select id="css-counter" className={sel} value={v.counter} onChange={(e) => setV({ ...v, counter: e.target.value as Counter })}>{COUNTERS.map((k) => <option key={k} value={k}>{l[`counterKind.${k}`]}</option>)}</select></div>
          </div>
          <div className="space-y-1"><Label htmlFor="css-note">{l.note}</Label><Input id="css-note" maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" disabled={s.pending} onClick={() => s.run(() => updateSiteAction({ id: siteId, countEveryDays: v.countEveryDays, counter: v.counter, note: v.note || null }), undefined, l.saved)}><Spin on={s.pending} icon={Save} /> {l.save}</Button>
            <Msg error={s.error} done={s.done} />
          </div>
        </>
      )}
      {canClose && (
        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <Button variant="outline" disabled={c.pending} onClick={() => c.run(() => closeSiteAction({ id: siteId }))} data-testid="cs-close"><Spin on={c.pending} icon={XCircle} /> {status === "PENDING" ? l.withdraw : l.close}</Button>
          {status === "ACTIVE" && <span className="text-xs text-muted-foreground">{l.closeHint}</span>}
          <Msg error={c.error} />
        </div>
      )}
    </div>
  );
}

export function RetryCount({ l, id }: { l: L; id: string }) {
  const s = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={s.pending} onClick={() => s.run(() => retryCountAction({ id }))} data-testid="cs-retry"><Spin on={s.pending} icon={RotateCcw} /> {l.retry}</Button>
      <Msg error={s.error} />
    </span>
  );
}

// ── both sides ──────────────────────────────────────────────────────────────

export function ReceiveShipment({ l, id, lines }: { l: L; id: string; lines: Line[] }) {
  const s = useRun();
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(lines.map((x) => [x.offerId, String(x.max)])));
  return (
    <div className="space-y-2" data-testid="cs-receive" data-id={id}>
      <p className="text-sm text-muted-foreground">{l.receiveHint}</p>
      <QtyRows l={l} lines={lines} value={v} onChange={setV} label={l.received} testid="cs-receive" />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={s.pending} onClick={() => s.run(() => receiveShipmentAction({ id, received: toQty(v, lines, "max") }))} data-testid="cs-receive-go"><Spin on={s.pending} icon={PackageCheck} /> {l.confirmReceived}</Button>
        <Msg error={s.error} />
      </div>
    </div>
  );
}

export function CountForm({ l, siteId, lines }: { l: L; siteId: string; lines: Line[] }) {
  const s = useRun();
  const [v, setV] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const filled = lines.every((x) => v[x.offerId] != null && v[x.offerId] !== "");
  return (
    <div className="space-y-3" data-testid="cs-count">
      <p className="text-sm text-muted-foreground">{l.countHint}</p>
      <QtyRows l={l} lines={lines} value={v} onChange={setV} label={l.counted} testid="cs-count" />
      <Input placeholder={l.note} aria-label={l.note} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={s.pending || !filled} onClick={() => s.run(() => submitCountAction({ id: siteId, counted: toQty(v, lines, "zero"), note: note || null }), (d) => { setOk(f(l.countSent, { number: (d as { number: string }).number })); setV({}); setNote(""); })} data-testid="cs-count-go">
          <Spin on={s.pending} icon={ClipboardCheck} /> {l.submitCount}
        </Button>
        {ok && <span className="text-sm" role="status" data-testid="cs-count-ok">{ok}</span>}
        <Msg error={s.error} />
      </div>
    </div>
  );
}

export function DecideCount({ l, id }: { l: L; id: string }) {
  const s = useRun();
  const [why, setWhy] = useState<string | null>(null);
  return (
    <div className="space-y-2" data-testid="cs-decide" data-id={id}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={s.pending} onClick={() => s.run(() => decideCountAction({ id, accept: true }))} data-testid="cs-accept"><Spin on={s.pending} icon={Check} /> {l.accept}</Button>
        <Button size="sm" variant="outline" disabled={s.pending} onClick={() => setWhy(why == null ? "" : null)} data-testid="cs-dispute-open"><Ban className="size-4" /> {l.dispute}</Button>
      </div>
      {why != null && (
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); s.run(() => decideCountAction({ id, accept: false, note: why })); }}>
          <Input className="min-w-0 flex-1 basis-56" placeholder={l.disputeWhy} aria-label={l.disputeWhy} maxLength={500} value={why} onChange={(e) => setWhy(e.target.value)} data-testid="cs-dispute-note" />
          <Button type="submit" size="sm" variant="outline" disabled={s.pending || !why.trim()} data-testid="cs-dispute-go">{l.dispute}</Button>
        </form>
      )}
      <Msg error={s.error} />
    </div>
  );
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export function AdminConsignmentSettings({ settings }: { settings: ConsignmentSettings }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(settings);
  const num = (k: "autoConfirmDays" | "expiryAlertDays" | "defaultCountEveryDays", label: string, max: number) => (
    <div className="w-full space-y-1 sm:w-56"><Label htmlFor={`csa-${k}`}>{label}</Label><Input id={`csa-${k}`} type="number" min={1} max={max} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} data-testid={`csa-${k}`} /></div>
  );
  const box = (checked: boolean, on: (b: boolean) => void, text: string, testid: string) => (
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4" checked={checked} onChange={(e) => on(e.target.checked)} data-testid={testid} /> <span>{text}</span></label>
  );
  return (
    <div className="space-y-4" data-testid="csa-settings">
      {box(v.enabled, (b) => setV({ ...v, enabled: b }), "Consignment stock is on", "csa-enabled")}
      <div className="space-y-1">
        <p className="text-sm font-medium">Channels</p>
        <div className="flex flex-wrap gap-4">
          {box(v.channels.DISTRIBUTOR_WHOLESALER, (b) => setV({ ...v, channels: { ...v.channels, DISTRIBUTOR_WHOLESALER: b } }), "Distributors → wholesalers", "csa-ch-DISTRIBUTOR_WHOLESALER")}
          {box(v.channels.WHOLESALER_CUSTOMER, (b) => setV({ ...v, channels: { ...v.channels, WHOLESALER_CUSTOMER: b } }), "Wholesalers → shops & restaurants", "csa-ch-WHOLESALER_CUSTOMER")}
        </div>
      </div>
      {box(v.requireApproval, (b) => setV({ ...v, requireApproval: b }), "FIRINGI approves each new consignment before stock can be sent", "csa-approval")}
      {box(v.allowCustomerCount, (b) => setV({ ...v, allowCustomerCount: b }), "Customers may count consignment stock themselves (the supplier confirms)", "csa-customer-count")}
      <div className="flex flex-wrap gap-4">
        {num("autoConfirmDays", "Unanswered count confirmed after (days)", 30)}
        {num("expiryAlertDays", "Alert the supplier when goods expire within (days)", 90)}
        {num("defaultCountEveryDays", "Default count interval (days)", 90)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending} onClick={() => run(() => saveConsignmentSettingsAction({ enabled: v.enabled, channels: v.channels, requireApproval: v.requireApproval, allowCustomerCount: v.allowCustomerCount, autoConfirmDays: v.autoConfirmDays, expiryAlertDays: v.expiryAlertDays, defaultCountEveryDays: v.defaultCountEveryDays }), undefined, "Saved")} data-testid="csa-save">
          <Spin on={pending} icon={Save} /> Save
        </Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function DecideSite({ id }: { id: string }) {
  const s = useRun();
  const [why, setWhy] = useState<string | null>(null);
  return (
    <div className="space-y-2" data-testid="csa-decide" data-id={id}>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={s.pending} onClick={() => s.run(() => decideSiteAction({ id, approve: true }))} data-testid="csa-approve"><Spin on={s.pending} icon={Check} /> Approve</Button>
        <Button size="sm" variant="outline" disabled={s.pending} onClick={() => setWhy(why == null ? "" : null)} data-testid="csa-reject-open"><Ban className="size-4" /> Reject</Button>
      </div>
      {why != null && (
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); s.run(() => decideSiteAction({ id, approve: false, reason: why })); }}>
          <Input className="min-w-0 flex-1 basis-56" placeholder="Reason (the supplier sees it)" aria-label="Reason" maxLength={500} value={why} onChange={(e) => setWhy(e.target.value)} data-testid="csa-reject-reason" />
          <Button type="submit" size="sm" variant="outline" disabled={s.pending || !why.trim()} data-testid="csa-reject-go">Reject</Button>
        </form>
      )}
      <Msg error={s.error} />
    </div>
  );
}

export function VendorSwitch({ vendorId, on }: { vendorId: string; on: boolean }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant={on ? "outline" : "default"} disabled={pending} onClick={() => run(() => setVendorConsignmentAction({ vendorId, on: !on }))} data-testid="csa-vendor-switch" data-on={on}><Spin on={pending} icon={on ? Ban : Check} /> {on ? "Switch off" : "Switch on"}</Button>
      <Msg error={error} />
    </span>
  );
}

export function SwitchOffVendor() {
  const s = useRun();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ id: string; name: string }[] | null>(null);
  return (
    <div className="space-y-2">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); s.run(() => searchConsignmentVendorsAction({ q }), (d) => setFound(d as { id: string; name: string }[])); }}>
        <Input placeholder="Search a supplier" aria-label="Search a supplier" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" variant="outline" disabled={s.pending} aria-label="Search"><Spin on={s.pending} icon={Search} /></Button>
      </form>
      {found && (found.length === 0 ? <p className="text-sm text-muted-foreground">No suppliers found.</p> : <ul className="divide-y rounded-md border">{found.map((v) => <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm"><span className="min-w-0 break-words">{v.name}</span><VendorSwitch vendorId={v.id} on /></li>)}</ul>)}
      <Msg error={s.error} />
    </div>
  );
}
