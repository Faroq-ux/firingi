"use client";
/** Van sales (Phase 63) — forms and the seller's phone screen (texts passed in as `l`; FIRINGI's in English). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ban, Check, CloudOff, PackagePlus, Play, Plus, Minus, RefreshCw, Save, Search, Trash2, Truck, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  addToLoadAction, cancelLoadAction, closeLoadAction, createLoadAction, loadableProductsAction, netVanCashAction, removeFromLoadAction,
  saveVanSalesSettingsAction, searchVanVendorsAction, sellFromVanAction, setVendorVanSalesAction, startRoundAction, vanCustomersAction, vanPricesAction,
} from "@/server/actions/vansales";
import { changeDue, estimateGross, VAN_METHODS, type VanMethod, type VanSalesSettings } from "@/lib/van-sales";

export type L = Record<string, string>;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const sel = "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm";
const money = (n: number, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);

// ── manager ─────────────────────────────────────────────────────────────────

export function NewLoadForm({ l, warehouses, sellers, vehicles }: { l: L; warehouses: { id: string; name: string }[]; sellers: { id: string; name: string }[]; vehicles: { id: string; name: string }[] }) {
  const { pending, error, run, router } = useRun();
  const [v, setV] = useState({ warehouseId: warehouses[0]?.id ?? "", sellerUserId: "", vehicleId: "", note: "" });
  if (!warehouses.length) return <p className="text-sm text-muted-foreground">{l.noWarehouses}</p>;
  if (!sellers.length) return <p className="text-sm text-muted-foreground" data-testid="vl-no-sellers">{l.noSellers}</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="vl-new">
      <div className="min-w-0 space-y-1"><Label htmlFor="vl-wh">{l.warehouse}</Label><select id="vl-wh" className={sel} value={v.warehouseId} onChange={(e) => setV({ ...v, warehouseId: e.target.value })} data-testid="vl-warehouse">{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
      <div className="min-w-0 space-y-1"><Label htmlFor="vl-seller">{l.seller}</Label><select id="vl-seller" className={sel} value={v.sellerUserId} onChange={(e) => setV({ ...v, sellerUserId: e.target.value })} data-testid="vl-seller"><option value="">—</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      <div className="min-w-0 space-y-1"><Label htmlFor="vl-veh">{l.vehicle}</Label><select id="vl-veh" className={sel} value={v.vehicleId} onChange={(e) => setV({ ...v, vehicleId: e.target.value })} data-testid="vl-vehicle"><option value="">{l.noVehicle}</option>{vehicles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
      <div className="min-w-0 space-y-1"><Label htmlFor="vl-note">{l.note}</Label><Input id="vl-note" maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
        <Button disabled={pending || !v.warehouseId || !v.sellerUserId} data-testid="vl-create"
          onClick={() => run(() => createLoadAction({ warehouseId: v.warehouseId, sellerUserId: v.sellerUserId, vehicleId: v.vehicleId || null, note: v.note || null }), (d) => router.push(`/vendor/van/${(d as { id: string }).id}`))}>
          <Spin on={pending} icon={Truck} /> {l.create}
        </Button>
        <Msg error={error} />
      </div>
    </div>
  );
}

type Loadable = { offerId: string; name: string; packaging: string; sku: string; free: number };

export function LoadGoods({ l, loadId }: { l: L; loadId: string }) {
  const search = useRun();
  const add = useRun();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Loadable[] | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const find = (text: string) => search.run(() => loadableProductsAction({ loadId, q: text || null }), (d) => setFound(d as Loadable[]));
  return (
    <div className="space-y-3" data-testid="vl-load-goods">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); find(q); }}>
        <Input placeholder={l.searchProducts} aria-label={l.searchProducts} value={q} onChange={(e) => setQ(e.target.value)} data-testid="vl-product-search" />
        <Button type="submit" variant="outline" disabled={search.pending} aria-label={l.searchProducts}><Spin on={search.pending} icon={Search} /></Button>
      </form>
      <Msg error={search.error} />
      {found && (found.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : (
        <ul className="max-h-80 divide-y overflow-y-auto rounded-md border" data-testid="vl-products">
          {found.map((p) => (
            <li key={p.offerId} className="flex flex-wrap items-center gap-2 p-2 text-sm" data-testid="vl-product" data-offer={p.offerId}>
              <span className="min-w-0 flex-1 basis-48 break-words">{p.name} <span className="text-xs text-muted-foreground">· {p.packaging} · {p.sku} · {f(l.free, { n: p.free })}</span></span>
              <Input className="h-8 w-20 text-center" inputMode="numeric" aria-label={l.qty} value={qty[p.offerId] ?? ""} placeholder={l.qty} onChange={(e) => setQty({ ...qty, [p.offerId]: e.target.value })} data-testid="vl-qty" />
              <Button size="sm" variant="outline" disabled={add.pending || !(Number(qty[p.offerId]) > 0)} data-testid="vl-add"
                onClick={() => add.run(() => addToLoadAction({ loadId, offerId: p.offerId, qty: Math.floor(Number(qty[p.offerId])) }), () => { setQty({ ...qty, [p.offerId]: "" }); find(q); })}>
                <PackagePlus className="size-4" /> {l.add}
              </Button>
            </li>
          ))}
        </ul>
      ))}
      <Msg error={add.error} />
    </div>
  );
}

export function RemoveGoods({ l, loadId, offerId }: { l: L; loadId: string; offerId: string }) {
  const { pending, error, run } = useRun();
  return <><Button size="sm" variant="ghost" disabled={pending} aria-label={l.remove} onClick={() => run(() => removeFromLoadAction({ loadId, offerId }))} data-testid="vl-remove"><Spin on={pending} icon={Trash2} /></Button><Msg error={error} /></>;
}

export function LoadButtons({ l, loadId }: { l: L; loadId: string }) {
  const { pending, error, run } = useRun();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={pending} onClick={() => run(() => startRoundAction({ loadId }))} data-testid="vl-start"><Spin on={pending} icon={Play} /> {l.startRound}</Button>
      {confirm
        ? <><Button variant="destructive" disabled={pending} onClick={() => run(() => cancelLoadAction({ loadId }))} data-testid="vl-cancel-yes"><Ban className="size-4" /> {l.cancelLoad}</Button><Button variant="ghost" onClick={() => setConfirm(false)} aria-label="×"><X className="size-4" /></Button><span className="text-xs text-muted-foreground">{l.cancelHint}</span></>
        : <Button variant="outline" disabled={pending} onClick={() => setConfirm(true)} data-testid="vl-cancel"><Undo2 className="size-4" /> {l.cancelLoad}</Button>}
      <Msg error={error} />
    </div>
  );
}

/** End of the day: count what comes back and the cash. */
export function UnloadForm({ l, locale, loadId, products, cashExpected }: { l: L; locale: string; loadId: string; products: { offerId: string; name: string; packaging: string; left: number }[]; cashExpected: number }) {
  const { pending, error, run } = useRun();
  const [counts, setCounts] = useState<Record<string, string>>(Object.fromEntries(products.map((p) => [p.offerId, String(p.left)])));
  const [cash, setCash] = useState(cashExpected.toFixed(2));
  const [note, setNote] = useState("");
  const [res, setRes] = useState<{ variance: number; lostUnits: number } | null>(null);
  const cashN = Number(cash.replace(",", "."));
  const variance = Number.isFinite(cashN) ? Math.round((cashN - cashExpected) * 100) / 100 : 0;
  if (res) return <p className="rounded-md bg-muted p-3 text-sm" role="status" data-testid="vl-closed">{f(l.closed, { variance: money(res.variance, locale), missing: res.lostUnits })}</p>;
  return (
    <div className="space-y-4" data-testid="vl-unload">
      <p className="text-sm text-muted-foreground">{l.unloadHint}</p>
      {products.length > 0 && (
        <ul className="divide-y rounded-md border">
          {products.map((p) => (
            <li key={p.offerId} className="flex flex-wrap items-center gap-2 p-2 text-sm" data-testid="vl-count-row">
              <span className="min-w-0 flex-1 basis-48 break-words">{p.name} <span className="text-xs text-muted-foreground">· {p.packaging} · {f(l.onVan ?? "{n}", { n: p.left })}</span></span>
              <Label htmlFor={`cnt-${p.offerId}`} className="sr-only">{l.countBack}</Label>
              <Input id={`cnt-${p.offerId}`} className="h-8 w-20 text-center" inputMode="numeric" value={counts[p.offerId] ?? ""} onChange={(e) => setCounts({ ...counts, [p.offerId]: e.target.value })} data-testid="vl-count" />
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><p className="text-sm">{l.cashExpected}</p><p className="h-9 font-semibold tabular-nums leading-9" data-testid="vl-cash-expected">{money(cashExpected, locale)}</p></div>
        <div className="space-y-1"><Label htmlFor="vl-cash">{l.cashCounted}</Label><Input id="vl-cash" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} data-testid="vl-cash" /></div>
        <div className="space-y-1"><p className="text-sm">{l.variance}</p><p className={`h-9 font-semibold tabular-nums leading-9 ${variance < 0 ? "text-destructive" : ""}`} data-testid="vl-variance">{money(variance, locale)}</p></div>
      </div>
      <div className="space-y-1"><Label htmlFor="vl-close-note">{l.closeNote}</Label><Input id="vl-close-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending || !Number.isFinite(cashN) || cashN < 0} data-testid="vl-close"
          onClick={() => run(() => closeLoadAction({ loadId, counted: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Math.max(0, Math.floor(Number(v) || 0))])), cashCounted: cashN, note: note || null }), (d) => setRes(d as { variance: number; lostUnits: number }))}>
          <Spin on={pending} icon={Check} /> {l.close}
        </Button>
        <Msg error={error} />
      </div>
    </div>
  );
}

// ── the seller (phone) ──────────────────────────────────────────────────────

type Customer = { id: string; name: string; taxId: string; addresses: { id: string; label: string }[] };
type Price = { offerId: string; name: string; packaging: string; sku: string; unitNet: number; vatPct: number; left: number };
type Empty = { typeId: string; name: string };
type SaleRes = { number: string; orderNumber: string | null; invoiceNumber: string | null; gross: number; paid: number; method: VanMethod };

async function store() { return import("@/lib/offline/store"); }

function SignaturePad({ l, onChange }: { l: L; onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drawn = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio; c.height = c.offsetHeight * ratio;
    const g = c.getContext("2d")!;
    g.scale(ratio, ratio); g.lineWidth = 2.2; g.lineCap = "round"; g.strokeStyle = "#111827";
  }, []);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between"><Label>{l.signHere}</Label>
        <button type="button" className="text-xs text-primary" onClick={() => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); drawn.current = false; onChange(null); }}>{l.clear}</button>
      </div>
      <canvas ref={ref} data-testid="vs-signature" className="h-36 w-full touch-none rounded-md border bg-white"
        onPointerDown={(e) => { drawing.current = true; const g = e.currentTarget.getContext("2d")!; const [x, y] = pos(e); g.beginPath(); g.moveTo(x, y); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!drawing.current) return; const g = e.currentTarget.getContext("2d")!; const [x, y] = pos(e); g.lineTo(x, y); g.stroke(); drawn.current = true; }}
        onPointerUp={(e) => { drawing.current = false; if (drawn.current) onChange(e.currentTarget.toDataURL("image/png")); }} />
    </div>
  );
}

/**
 * The seller's sale: customer → products from the van at the customer's prices → payment → signature → confirm.
 * Online: placed at once (exact invoice amount back). Without signal: kept on the phone (outbox) and sent later.
 */
export function VanSeller({ l, locale, userId, settings, recent, empties }: {
  l: L; locale: string; userId: string; recent: Customer[]; empties: Empty[];
  settings: { methods: Record<VanMethod, boolean>; maxCashPerSale: number; requireSignature: boolean; allowEmpties: boolean; allowOffline: boolean };
}) {
  const { pending, error, run } = useRun();
  const search = useRun();
  const [online, setOnline] = useState(true);
  const [q, setQ] = useState("");
  const [customers, setCustomers] = useState<Customer[]>(recent);
  const [cust, setCust] = useState<Customer | null>(null);
  const [addressId, setAddressId] = useState("");
  const [prices, setPrices] = useState<Price[] | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const methods = VAN_METHODS.filter((m) => settings.methods[m]);
  const [method, setMethod] = useState<VanMethod | "">(methods[0] ?? "");
  const [given, setGiven] = useState("");
  const [back, setBack] = useState<Record<string, string>>({});
  const [signedBy, setSignedBy] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [done, setDone] = useState<SaleRes | null>(null);
  const [queued, setQueued] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [readyMsg, setReadyMsg] = useState<string | null>(null);

  const refreshWaiting = useCallback(async () => {
    try { const s = await store(); setWaiting((await s.outbox()).filter((e) => e.userId === userId && e.kind === "van.sale" && (e.state === "WAITING" || e.state === "SENDING")).length); } catch { /* no IndexedDB */ }
  }, [userId]);
  useEffect(() => {
    const on = () => { setOnline(navigator.onLine); if (navigator.onLine) void store().then((s) => s.flush(userId)).then(refreshWaiting); };
    on();
    window.addEventListener("online", on); window.addEventListener("offline", on);
    const t = setInterval(refreshWaiting, 5000);
    void refreshWaiting();
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); clearInterval(t); };
  }, [userId, refreshWaiting]);

  const lines = useMemo(() => (prices ?? []).filter((p) => (qty[p.offerId] ?? 0) > 0).map((p) => ({ ...p, qty: qty[p.offerId] })), [prices, qty]);
  const est = estimateGross(lines.map((x) => ({ qty: x.qty, unitNet: x.unitNet, vatPct: x.vatPct })));
  const overCash = method === "CASH" && settings.maxCashPerSale > 0 && est.gross > settings.maxCashPerSale;
  const needSign = settings.requireSignature && (!signedBy.trim() || !signature);

  const findCustomers = (text: string) => {
    if (!online) { const t = text.trim().toLowerCase(); setCustomers(recent.filter((c) => !t || c.name.toLowerCase().includes(t) || c.taxId.includes(t))); return; }
    search.run(() => vanCustomersAction({ q: text || null }), (d) => setCustomers(d as Customer[]));
  };
  const pick = async (c: Customer) => {
    setCust(c); setAddressId(c.addresses[0]?.id ?? ""); setQty({}); setPrices(null); setRef(`v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
    const key = `van.prices.${c.id}`;
    if (online) {
      const r = await vanPricesAction({ buyerCompanyId: c.id });
      if (r.ok) { setPrices(r.data as Price[]); try { await (await store()).kvSet(key, r.data); } catch { /* ignore */ } return; }
    }
    try { setPrices(((await (await store()).kvGet<Price[]>(key)) ?? []) as Price[]); } catch { setPrices([]); }
  };
  const getReady = async () => {
    let n = 0;
    for (const c of recent.slice(0, 25)) {
      const r = await vanPricesAction({ buyerCompanyId: c.id });
      if (r.ok) { try { await (await store()).kvSet(`van.prices.${c.id}`, r.data); n++; } catch { /* ignore */ } }
    }
    setReadyMsg(f(l.ready, { n }));
  };
  const reset = () => { setCust(null); setPrices(null); setQty({}); setGiven(""); setBack({}); setSignedBy(""); setSignature(null); setDone(null); setQueued(null); };
  const payload = () => ({
    buyerCompanyId: cust!.id, addressId, method: method as VanMethod, items: lines.map((x) => ({ offerId: x.offerId, qty: x.qty })),
    signedBy: signedBy.trim() || null, signature, clientRef: ref,
    empties: Object.fromEntries(Object.entries(back).map(([k, v]) => [k, Math.max(0, Math.floor(Number(v) || 0))]).filter(([, v]) => (v as number) > 0)),
  });
  const keepOffline = async () => {
    const s = await store();
    const data = { ...payload(), soldAt: new Date().toISOString() };
    await s.queue(userId, "vendor", "van.sale", data, `${cust!.name} · ${money(est.gross, locale)}`);
    setQueued(est.gross); void refreshWaiting();
  };
  const confirm = () => {
    if (!online) { if (settings.allowOffline) void keepOffline(); return; }
    run(async () => {
      try { return await sellFromVanAction(payload()); }
      catch { if (settings.allowOffline) { await keepOffline(); return { ok: true as const, data: null }; } return { ok: false as const, error: l.offline }; }
    }, (d) => { if (d) setDone(d as SaleRes); });
  };

  if (done || queued != null) {
    return (
      <div className="space-y-3 rounded-xl border p-4" data-testid="vs-done" data-queued={queued != null}>
        {done ? (
          <>
            <p className="text-sm" role="status">{f(l.saleDone, { number: done.number, order: done.orderNumber ?? "—", invoice: done.invoiceNumber ?? "—" })}</p>
            {done.method === "ON_ACCOUNT"
              ? <p className="text-lg font-semibold" data-testid="vs-collect">{l.onAccount}</p>
              : <p className="text-2xl font-semibold tabular-nums" data-testid="vs-collect" data-amount={done.paid}>{f(l.collect, { amount: money(done.paid, locale) })}</p>}
            {done.method === "CASH" && Number(given.replace(",", ".")) > 0 && <p className="text-sm">{f(l.changeDue, { amount: money(changeDue(done.paid, Number(given.replace(",", "."))), locale) })}</p>}
          </>
        ) : (
          <>
            <p className="flex items-center gap-2 text-sm" role="status"><CloudOff className="size-4" /> {l.savedOffline}</p>
            <p className="text-2xl font-semibold tabular-nums">{f(l.offlineEstimate, { amount: money(queued!, locale) })}</p>
          </>
        )}
        <Button onClick={reset} data-testid="vs-new"><Plus className="size-4" /> {l.newSale}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="vs-seller">
      {(!online || waiting > 0) && (
        <p className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-2 text-sm" data-testid="vs-offline">
          {!online && <><CloudOff className="size-4" /> {l.offline}</>} {waiting > 0 && <span>{f(l.waiting, { n: waiting })}</span>}
        </p>
      )}
      {/* 1. customer */}
      <section className="space-y-2">
        <h2 className="font-semibold">{l.step1}</h2>
        {cust ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm" data-testid="vs-customer" data-id={cust.id}>
            <span className="min-w-0 flex-1 basis-40 break-words font-medium">{cust.name} <span className="font-normal text-muted-foreground">· {cust.taxId}</span></span>
            <Button size="sm" variant="ghost" onClick={reset}>{l.change}</Button>
            <div className="w-full space-y-1"><Label htmlFor="vs-addr">{l.address}</Label><select id="vs-addr" className={sel} value={addressId} onChange={(e) => setAddressId(e.target.value)}>{cust.addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></div>
          </div>
        ) : (
          <>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); findCustomers(q); }}>
              <Input placeholder={l.searchCustomer} aria-label={l.searchCustomer} value={q} onChange={(e) => setQ(e.target.value)} data-testid="vs-customer-search" />
              <Button type="submit" variant="outline" disabled={search.pending} aria-label={l.searchCustomer}><Spin on={search.pending} icon={Search} /></Button>
            </form>
            <Msg error={search.error} />
            {customers.length === 0 ? <p className="text-sm text-muted-foreground">{l.noCustomers}</p> : (
              <ul className="max-h-72 divide-y overflow-y-auto rounded-md border" data-testid="vs-customers">
                {customers.map((c) => <li key={c.id}><button type="button" className="w-full p-3 text-left text-sm hover:bg-muted" onClick={() => void pick(c)} data-testid="vs-pick-customer">{c.name} <span className="text-xs text-muted-foreground">· {c.taxId}</span></button></li>)}
              </ul>
            )}
            {online && recent.length > 0 && settings.allowOffline && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Button size="sm" variant="outline" onClick={() => void getReady()} data-testid="vs-get-ready"><RefreshCw className="size-4" /> {l.getReady}</Button>
                <span className="text-xs text-muted-foreground">{readyMsg ?? l.getReadyHint}</span>
              </div>
            )}
          </>
        )}
      </section>
      {cust && (
        <>
          {/* 2. products */}
          <section className="space-y-2">
            <h2 className="font-semibold">{l.step2}</h2>
            {prices == null ? <Spin on icon={RefreshCw} /> : prices.length === 0 ? <p className="text-sm text-muted-foreground">{l.noPrices}</p> : (
              <ul className="divide-y rounded-md border" data-testid="vs-products">
                {prices.map((p) => {
                  const n = qty[p.offerId] ?? 0;
                  const set = (v: number) => setQty({ ...qty, [p.offerId]: Math.max(0, Math.min(p.left, Math.floor(v) || 0)) });
                  return (
                    <li key={p.offerId} className="flex flex-wrap items-center gap-2 p-2 text-sm" data-testid="vs-product" data-offer={p.offerId}>
                      <span className="min-w-0 flex-1 basis-44 break-words">{p.name} <span className="text-xs text-muted-foreground">· {p.packaging} · {f(l.onVan, { n: p.left })}</span></span>
                      <span className="tabular-nums">{money(p.unitNet, locale)}</span>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="outline" className="size-9" aria-label="−" onClick={() => set(n - 1)}><Minus className="size-4" /></Button>
                        <Input className="h-9 w-14 text-center" inputMode="numeric" aria-label={l.qty} value={n || ""} onChange={(e) => set(Number(e.target.value))} data-testid="vs-qty" />
                        <Button size="icon" variant="outline" className="size-9" aria-label="+" onClick={() => set(n + 1)} data-testid="vs-plus"><Plus className="size-4" /></Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {lines.length > 0 && (
              <dl className="grid grid-cols-3 gap-2 rounded-md bg-muted p-3 text-sm">
                <div><dt className="text-xs text-muted-foreground">{l.net}</dt><dd className="tabular-nums">{money(est.net, locale)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{l.vat}</dt><dd className="tabular-nums">{money(est.vat, locale)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{l.estimate}</dt><dd className="font-semibold tabular-nums" data-testid="vs-estimate">{money(est.gross, locale)}</dd></div>
                <p className="col-span-3 text-xs text-muted-foreground">{l.estimateHint}</p>
              </dl>
            )}
          </section>
          {lines.length > 0 && (
            <>
              {/* 3. payment (+ empties) */}
              <section className="space-y-2">
                <h2 className="font-semibold">{l.step3}</h2>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label={l.payment}>
                  {methods.map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)} data-testid={`vs-method-${m}`}
                      className={`h-11 rounded-md border px-2 text-sm font-medium ${method === m ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{l[`method.${m}`] ?? m}</button>
                  ))}
                </div>
                {method === "CASH" && (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="w-40 space-y-1"><Label htmlFor="vs-given">{l.cashGiven}</Label><Input id="vs-given" inputMode="decimal" value={given} onChange={(e) => setGiven(e.target.value)} data-testid="vs-given" /></div>
                    {Number(given.replace(",", ".")) > 0 && <p className="pb-2 text-sm" data-testid="vs-change">{f(l.changeDue, { amount: money(changeDue(est.gross, Number(given.replace(",", "."))), locale) })}</p>}
                  </div>
                )}
                {overCash && <p className="text-sm text-destructive" role="alert">{f(l.cashLimit, { amount: money(settings.maxCashPerSale, locale) })}</p>}
                {settings.allowEmpties && empties.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{l.empties} <span className="font-normal text-muted-foreground">· {l.emptiesHint}</span></p>
                    <div className="flex flex-wrap gap-3">
                      {empties.map((e) => (
                        <label key={e.typeId} className="flex items-center gap-2 text-sm">
                          <span className="min-w-0 break-words">{e.name}</span>
                          <Input className="h-8 w-16 text-center" inputMode="numeric" value={back[e.typeId] ?? ""} onChange={(x) => setBack({ ...back, [e.typeId]: x.target.value })} data-testid="vs-empty" />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </section>
              {/* 4. signature */}
              <section className="space-y-2">
                <h2 className="font-semibold">{l.step4}</h2>
                <div className="space-y-1"><Label htmlFor="vs-sign-name">{l.signName}</Label><Input id="vs-sign-name" maxLength={120} value={signedBy} onChange={(e) => setSignedBy(e.target.value)} data-testid="vs-signed-by" /></div>
                <SignaturePad l={l} onChange={setSignature} />
              </section>
              <div className="space-y-2">
                <Button className="h-12 w-full text-base" disabled={pending || !method || !addressId || overCash || needSign || (!online && !settings.allowOffline)} onClick={confirm} data-testid="vs-confirm">
                  <Spin on={pending} icon={Check} /> {l.confirmSale} · {money(est.gross, locale)}
                </Button>
                <Msg error={error} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export function AdminVanSettings({ settings }: { settings: VanSalesSettings }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(settings);
  const box = (k: "enabled" | "requireSignature" | "allowEmpties" | "allowOffline", label: string) => (
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4" checked={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} data-testid={`vss-${k}`} /> <span>{label}</span></label>
  );
  const NAMES: Record<VanMethod, string> = { CASH: "Cash", CARD: "Card", MB_WAY: "MB WAY", ON_ACCOUNT: "On account (customer's credit)" };
  return (
    <div className="space-y-4" data-testid="vs-settings">
      {box("enabled", "Van sales are on (suppliers can load vans and sell from them)")}
      <div className="space-y-1">
        <p className="text-sm font-medium">Payment methods the seller may take</p>
        <div className="flex flex-wrap gap-4">
          {VAN_METHODS.map((m) => <label key={m} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={v.methods[m]} onChange={(e) => setV({ ...v, methods: { ...v.methods, [m]: e.target.checked } })} data-testid={`vss-m-${m}`} /> {NAMES[m]}</label>)}
        </div>
      </div>
      {box("requireSignature", "The customer signs on the phone for every sale")}
      {box("allowEmpties", "Sellers may take empties back at a sale")}
      {box("allowOffline", "Sales may be made without signal and sent later")}
      <div className="flex flex-wrap gap-3">
        <div className="w-48 space-y-1"><Label htmlFor="vss-cash">Cash limit per sale (€, 0 = none)</Label><Input id="vss-cash" type="number" min={0} step="0.01" value={v.maxCashPerSale} onChange={(e) => setV({ ...v, maxCashPerSale: Number(e.target.value) })} data-testid="vss-cash" /></div>
        <div className="w-48 space-y-1"><Label htmlFor="vss-var">Cash difference alert (€)</Label><Input id="vss-var" type="number" min={0} step="0.01" value={v.varianceAlert} onChange={(e) => setV({ ...v, varianceAlert: Number(e.target.value) })} /></div>
        <div className="w-48 space-y-1"><Label htmlFor="vss-hours">Flag vans out longer than (hours)</Label><Input id="vss-hours" type="number" min={1} max={72} value={v.maxRoundHours} onChange={(e) => setV({ ...v, maxRoundHours: Number(e.target.value) })} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending} data-testid="vss-save"
          onClick={() => run(() => saveVanSalesSettingsAction({ enabled: v.enabled, methods: v.methods, maxCashPerSale: v.maxCashPerSale, requireSignature: v.requireSignature, allowEmpties: v.allowEmpties, allowOffline: v.allowOffline, varianceAlert: v.varianceAlert, maxRoundHours: v.maxRoundHours }), undefined, "Saved")}>
          <Spin on={pending} icon={Save} /> Save
        </Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function VendorSwitch({ vendorId, on }: { vendorId: string; on: boolean }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant={on ? "outline" : "default"} disabled={pending} onClick={() => run(() => setVendorVanSalesAction({ vendorId, on: !on }))} data-testid="vs-vendor-switch" data-on={on}>
        <Spin on={pending} icon={on ? Ban : Check} /> {on ? "Switch off" : "Switch on"}
      </Button>
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
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); s.run(() => searchVanVendorsAction({ q }), (d) => setFound(d as { id: string; name: string }[])); }}>
        <Input placeholder="Search a supplier" aria-label="Search a supplier" value={q} onChange={(e) => setQ(e.target.value)} data-testid="vs-vendor-search" />
        <Button type="submit" variant="outline" disabled={s.pending} aria-label="Search"><Spin on={s.pending} icon={Search} /></Button>
      </form>
      {found && (found.length === 0 ? <p className="text-sm text-muted-foreground">No suppliers found.</p> : (
        <ul className="divide-y rounded-md border">{found.map((v) => <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm"><span className="min-w-0 break-words">{v.name}</span><VendorSwitch vendorId={v.id} on /></li>)}</ul>
      ))}
      <Msg error={s.error} />
    </div>
  );
}

export function NetNow({ vendorId }: { vendorId: string }) {
  const { pending, error, done, run } = useRun();
  return <span className="inline-flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => netVanCashAction({ vendorId }), undefined, "Netted")} data-testid="vs-net"><Spin on={pending} icon={RefreshCw} /> Net now</Button><Msg error={error} done={done} /></span>;
}
