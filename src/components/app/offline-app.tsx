"use client";
/**
 * Phase 39 — offline mode (/offline): works from what the phone saved while online, with no signal.
 * Buyers order (sent when back online; the server re-checks prices and stock), see orders and saved
 * invoices; drivers work through the route (picked up, on the way, delivered with signature / photo,
 * or failed); suppliers pick with the scanner; everyone sees the outbox. The saved page carries the
 * person's language, so all texts come from the "app" messages.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Camera, Check, CheckCircle2, ChevronDown, CloudOff, FileText, MapPin, Minus, Package, Phone, Plus, RefreshCw, Search, Send, Trash2, Truck, Wifi, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Scanner } from "@/components/warehouse/scanner";
import { cachedDoc, flush, kvGet, kvSet, outbox, OUTBOX_EVENT, putEntry, queue, removeEntry, shrinkPhoto, type OutboxEntry } from "@/lib/offline/store";
import type { AppPortal } from "@/lib/app";
import { cn } from "@/lib/utils";
import { EmptiesCounter, type StopItem } from "@/components/returnables/client";

type Product = { offerId: string; name: string; packaging: string; brand: string | null; sku: string | null; gtin: string | null; unitGtin: string | null; supplier: string; unitNet: number; unitGross: number; minQty: number; step: number; available: number; stock: string; usualQty: number };
type BuyerOrder = { id: string; number: string; status: string; placedAt: string; total: number; supplier: string; deliveryDate: string | null; eta: string | null; delivery: string | null; lines: { name: string; packaging: string; qty: number; net: number }[] };
type Stop = { deliveryId: string; number: string; status: string; orderStatus: string; sequence: number; customer: string; phone: string | null; contact: string | null; supplier: string; address: string; lat: number | null; lng: number | null; note: string | null; scheduledFor: string | null; items: { name: string; packaging: string; qty: number }[]; empties?: StopItem[] };
type PickLine = { id: string; orderNumber: string; product: string; packaging: string; sku: string | null; gtin: string | null; batchId: string | null; lotCode: string | null; expiresOn: string | null; bin: string | null; qty: number; pickedQty: number; shortReason: string | null; blocked: boolean };
type PickList = { id: string; number: string; warehouse: string; note: string | null; orders: { id: string; number: string; buyer: string }[]; lines: PickLine[] };
type Snap = {
  at: string; portal: AppPortal; locale: string; user: { id: string; name: string }; company: { id: string; name: string; type: string };
  settings: { refreshMinutes: number; mode: "ASK" | "AUTO"; maxChangePct: number; documents: number };
  buy?: { products: Product[]; addresses: { id: string; label: string }[]; canOrder: boolean; orders: BuyerOrder[]; invoices: { id: string; number: string; kind: string; issuedAt: string | null; dueAt: string | null; total: number; pdf: string }[] };
  driver?: { canPod: boolean; reasons: string[]; stops: Stop[] };
  vendor?: { batchIds: string[]; pickLists: PickList[]; orders: { id: string; number: string; status: string; placedAt: string; deliveryDate: string | null; buyer: string; lines: { name: string; packaging: string; qty: number }[] }[] };
};
type Cart = { items: Record<string, number>; addressId: string; note: string };
type T = ReturnType<typeof useTranslations>;

const TABS: Record<AppPortal, string[]> = { buy: ["order", "orders", "invoices", "outbox"], driver: ["route", "outbox"], vendor: ["pick", "orders", "outbox"], admin: ["outbox"] };

export function OfflineApp() {
  const t = useTranslations("app");
  const [snap, setSnap] = useState<Snap | null | undefined>(undefined);
  const [portals, setPortals] = useState<AppPortal[]>([]);
  const [online, setOnline] = useState(true);
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [tab, setTab] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);
  const userRef = useRef<string | undefined>(undefined);

  const loadEntries = useCallback(async (userId?: string) => {
    const all = await outbox().catch(() => []);
    setEntries(userId ? all.filter((e) => e.userId === userId) : all);
  }, []);

  const load = useCallback(async (want?: AppPortal) => {
    const found: AppPortal[] = [];
    for (const p of ["buy", "driver", "vendor", "admin"] as AppPortal[]) if (await kvGet(`snap:${p}`).catch(() => null)) found.push(p);
    setPortals(found);
    const portal = want ?? (await kvGet<AppPortal>("lastPortal").catch(() => undefined)) ?? found[0];
    const s = portal ? ((await kvGet<Snap>(`snap:${portal}`).catch(() => undefined)) ?? null) : null;
    setSnap(s);
    if (s) {
      userRef.current = s.user.id;
      await kvSet("lastPortal", s.portal);
      const q = new URLSearchParams(location.search).get("tab");
      setTab((cur) => (q && TABS[s.portal].includes(q) ? q : TABS[s.portal].includes(cur) ? cur : TABS[s.portal][0]));
      await loadEntries(s.user.id);
    }
  }, [loadEntries]);

  useEffect(() => {
    void load();
    const on = () => { setOnline(true); if (userRef.current) void flush(userRef.current); };
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const changed = () => { if (userRef.current) void loadEntries(userRef.current); };
    window.addEventListener(OUTBOX_EVENT, changed);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); window.removeEventListener(OUTBOX_EVENT, changed); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (snap && navigator.onLine) void flush(snap.user.id); }, [snap]);

  if (snap === undefined) return <div className="grid min-h-dvh place-items-center text-muted-foreground"><RefreshCw className="size-6 animate-spin" /></div>;
  if (snap === null) return (
    <Shell t={t} online={online}>
      <div className="mx-auto mt-16 max-w-sm space-y-3 text-center" data-testid="offline-empty">
        <CloudOff className="mx-auto size-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{t("noDataTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("noDataText")}</p>
        {/* a full page load on purpose: the online app takes over from the saved offline page */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        {online && <a href="/" className="inline-block text-primary hover:underline">{t("openFiringi")}</a>}
      </div>
    </Shell>
  );

  const fmtMoney = (n: number) => new Intl.NumberFormat(snap.locale, { style: "currency", currency: "EUR" }).format(n);
  const fmtDate = (d: string, time = false) => new Intl.DateTimeFormat(snap.locale, time ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "medium" }).format(new Date(d));
  const attention = entries.filter((e) => e.state === "NEEDS_CONFIRM" || e.state === "FAILED").length;
  const waiting = entries.filter((e) => e.state === "WAITING" || e.state === "SENDING").length;
  const since = entries.filter((e) => e.at > snap.at && e.state !== "FAILED" && e.state !== "NEEDS_CONFIRM");

  return (
    <Shell t={t} online={online} portal={snap.portal} portals={portals} onPortal={(p) => void load(p)} savedAt={fmtDate(snap.at, true)} company={snap.company.name}>
      {notice && <p className="mb-3 flex items-center gap-2 rounded-lg border border-[color:var(--success,#16a34a)]/40 bg-[color:var(--success,#16a34a)]/10 px-3 py-2 text-sm" role="status" data-testid="offline-notice"><CheckCircle2 className="size-4" />{notice}<button className="ml-auto" onClick={() => setNotice(null)} aria-label={t("close")}><X className="size-4" /></button></p>}
      <nav className="mb-4 flex gap-1 rounded-xl border bg-card p-1" role="tablist">
        {TABS[snap.portal].map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("relative flex-auto break-normal rounded-lg px-2 py-2 text-xs font-medium leading-tight [hyphens:none] sm:px-3 sm:text-sm", tab === k ? "bg-primary text-primary-foreground" : "hover:bg-accent")} data-testid={`tab-${k}`}>
            {t(`tab.${k}`)}
            {k === "outbox" && (attention || waiting) ? <span className={cn("ml-1.5 rounded-full px-1.5 text-xs", attention ? "bg-destructive text-white" : "bg-muted text-foreground")}>{attention || waiting}</span> : null}
          </button>
        ))}
      </nav>
      {tab === "order" && snap.buy && <OrderTab t={t} snap={snap} money={fmtMoney} onPlaced={(msg) => { setNotice(msg); setTab("outbox"); }} />}
      {tab === "orders" && snap.buy && <BuyerOrders t={t} orders={snap.buy.orders} money={fmtMoney} date={fmtDate} />}
      {tab === "invoices" && snap.buy && <Invoices t={t} invoices={snap.buy.invoices} money={fmtMoney} date={fmtDate} online={online} />}
      {tab === "route" && snap.driver && <RouteTab t={t} snap={snap} since={since} />}
      {tab === "pick" && snap.vendor && <PickTab t={t} snap={snap} since={since} />}
      {tab === "orders" && snap.vendor && <VendorOrders t={t} orders={snap.vendor.orders} date={fmtDate} />}
      {tab === "outbox" && <OutboxTab t={t} entries={entries} online={online} userId={snap.user.id} money={fmtMoney} date={fmtDate} />}
    </Shell>
  );
}

function Shell({ t, online, portal, portals = [], onPortal, savedAt, company, children }: { t: T; online: boolean; portal?: AppPortal; portals?: AppPortal[]; onPortal?: (p: AppPortal) => void; savedAt?: string; company?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background pb-[env(safe-area-inset-bottom)]">
      <header className="glass-panel sticky top-0 z-20 border-b px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" className="size-9 rounded-lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight">{t("offlineTitle")}{company ? ` · ${company}` : ""}</p>
            {savedAt && <p className="truncate text-xs text-muted-foreground">{t("savedAt", { time: savedAt })}</p>}
          </div>
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", online ? "bg-[color:var(--success,#16a34a)]/15 text-[color:var(--success,#16a34a)]" : "bg-warning/20")} data-testid="net-status" data-online={online}>
            {online ? <Wifi className="size-3.5" /> : <CloudOff className="size-3.5" />}{online ? t("online") : t("offline")}
          </span>
          {online && portal && <a href={`/${portal}`} className="hidden rounded-md border px-2 py-1 text-xs hover:bg-accent sm:inline-block" data-testid="back-online">{t("backToApp")}</a>}
        </div>
        {(portals.length > 1 || (online && portal)) && (
          <div className="mx-auto mt-2 flex max-w-3xl flex-wrap items-center gap-2 text-xs">
            {portals.length > 1 && portals.map((p) => <button key={p} onClick={() => onPortal?.(p)} className={cn("rounded-full border px-2 py-0.5", p === portal ? "bg-secondary font-medium" : "hover:bg-accent")}>{t(`portal_${p}`)}</button>)}
            {online && portal && <a href={`/${portal}`} className="ml-auto rounded-md border px-2 py-0.5 hover:bg-accent sm:hidden">{t("backToApp")}</a>}
          </div>
        )}
      </header>
      <main className="mx-auto max-w-3xl p-4">{children}</main>
    </div>
  );
}

// ── buyer: order offline ─────────────────────────────────────────────────────

function OrderTab({ t, snap, money, onPlaced }: { t: T; snap: Snap; money: (n: number) => string; onPlaced: (msg: string) => void }) {
  const b = snap.buy!;
  const [cart, setCart] = useState<Cart>({ items: {}, addressId: b.addresses[0]?.id ?? "", note: "" });
  const [q, setQ] = useState("");
  const [scan, setScan] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void kvGet<Cart>(`cart:${snap.user.id}`).then((c) => { if (c) setCart({ ...c, addressId: b.addresses.some((a) => a.id === c.addressId) ? c.addressId : b.addresses[0]?.id ?? "" }); }); }, [snap.user.id, b.addresses]);
  const save = (c: Cart) => { setCart(c); void kvSet(`cart:${snap.user.id}`, c); };
  const byId = useMemo(() => new Map(b.products.map((p) => [p.offerId, p])), [b.products]);
  const set = (p: Product, qty: number) => {
    const items = { ...cart.items };
    if (qty <= 0) delete items[p.offerId];
    else items[p.offerId] = Math.max(p.minQty, p.minQty + Math.ceil((qty - p.minQty) / p.step) * p.step);
    save({ ...cart, items });
  };
  const shown = b.products.filter((p) => !q || `${p.name} ${p.packaging} ${p.brand ?? ""} ${p.sku ?? ""} ${p.gtin ?? ""} ${p.supplier}`.toLowerCase().includes(q.toLowerCase()));
  const lines = Object.entries(cart.items).map(([id, qty]) => ({ p: byId.get(id), qty })).filter((l): l is { p: Product; qty: number } => !!l.p);
  const total = lines.reduce((a, l) => a + l.p.unitNet * l.qty, 0);
  const onCode = (code: string) => {
    const p = b.products.find((x) => x.gtin === code || x.unitGtin === code || x.sku?.toLowerCase() === code.toLowerCase());
    if (!p) { setScanMsg(t("scanNotSaved", { code })); return; }
    set(p, (cart.items[p.offerId] ?? 0) + p.usualQty);
    setScanMsg(t("scanAdded", { name: p.name, qty: p.usualQty }));
  };
  const place = async () => {
    if (!lines.length || !cart.addressId) return;
    setBusy(true);
    const title = t("orderTitle", { n: lines.length, total: money(total) });
    await queue(snap.user.id, "buy", "order.place", { addressId: cart.addressId, note: cart.note || null, items: lines.map((l) => ({ offerId: l.p.offerId, qty: l.qty, seenUnitNet: l.p.unitNet, name: `${l.p.name} · ${l.p.packaging}` })) }, title);
    save({ items: {}, addressId: cart.addressId, note: "" });
    setBusy(false);
    onPlaced(navigator.onLine ? t("orderSending") : t("orderQueued"));
  };
  if (!b.canOrder) return <p className="text-sm text-muted-foreground">{t("cantOrder")}</p>;
  return (
    <div className="space-y-3 pb-40">
      <div className="flex gap-2">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchSaved")} className="h-11 pl-9" data-testid="offline-search" /></div>
        <Button variant={scan ? "default" : "outline"} className="h-11" onClick={() => { setScan((s) => !s); setScanMsg(null); }} data-testid="offline-scan"><Camera className="size-4" /> {t("scanShort")}</Button>
      </div>
      {scan && <div className="rounded-xl border p-3"><Scanner onCode={onCode} testId="offline-scan-input" placeholder={t("scanPlaceholder")} />{scanMsg && <p className="mt-2 text-sm" role="status">{scanMsg}</p>}</div>}
      <p className="text-xs text-muted-foreground">{t("savedProducts", { n: b.products.length })}</p>
      <ul className="divide-y rounded-xl border bg-card" data-testid="offline-products">
        {shown.slice(0, 120).map((p) => {
          const qty = cart.items[p.offerId] ?? 0;
          return (
            <li key={p.offerId} className="flex items-center gap-3 p-3" data-testid="offline-product" data-offer={p.offerId}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium leading-tight">{p.name}</p>
                <p className="truncate text-xs text-muted-foreground">{p.packaging} · {p.supplier}</p>
                <p className="text-sm tabular-nums">{money(p.unitNet)} <span className="text-xs text-muted-foreground">{t("exVat")}</span>{p.stock === "OUT" && <span className="ml-2 text-xs text-destructive">{t("outOfStock")}</span>}</p>
              </div>
              {qty ? (
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="outline" className="size-9" onClick={() => set(p, qty - p.step < p.minQty ? 0 : qty - p.step)} aria-label={t("less")}><Minus className="size-4" /></Button>
                  <span className="w-10 text-center font-semibold tabular-nums" data-testid="offline-qty">{qty}</span>
                  <Button size="icon" variant="outline" className="size-9" onClick={() => set(p, qty + p.step)} aria-label={t("more")}><Plus className="size-4" /></Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => set(p, p.usualQty)} data-testid="offline-add"><Plus className="size-4" /> {p.usualQty}</Button>
              )}
            </li>
          );
        })}
        {!shown.length && <li className="p-6 text-center text-sm text-muted-foreground">{t("nothingFound")}</li>}
      </ul>
      {lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background p-3 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.25)] pb-[calc(0.75rem+env(safe-area-inset-bottom))]" data-testid="offline-cart">
          <div className="mx-auto max-w-3xl space-y-2">
            <div className="flex items-center justify-between text-sm"><span>{t("cartLines", { n: lines.length })}</span><span className="font-semibold tabular-nums" data-testid="offline-total">{money(total)} <span className="text-xs font-normal text-muted-foreground">{t("exVat")}</span></span></div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={cart.addressId} onChange={(e) => save({ ...cart, addressId: e.target.value })} aria-label={t("deliverTo")} data-testid="offline-address">{b.addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select>
              <Input value={cart.note} onChange={(e) => save({ ...cart, note: e.target.value })} placeholder={t("noteOptional")} maxLength={500} />
            </div>
            <p className="text-xs text-muted-foreground">{snap.settings.mode === "AUTO" ? t("priceRuleAuto", { pct: snap.settings.maxChangePct }) : t("priceRuleAsk")}</p>
            <Button className="h-11 w-full" disabled={busy || !cart.addressId} onClick={place} data-testid="offline-place"><Send className="size-4" /> {navigator.onLine ? t("placeNow") : t("placeOffline")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function BuyerOrders({ t, orders, money, date }: { t: T; orders: BuyerOrder[]; money: (n: number) => string; date: (d: string, time?: boolean) => string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!orders.length) return <p className="text-sm text-muted-foreground">{t("noOrders")}</p>;
  return (
    <ul className="divide-y rounded-xl border bg-card" data-testid="offline-orders">
      {orders.map((o) => (
        <li key={o.id} className="p-3">
          <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(open === o.id ? null : o.id)}>
            <span className="min-w-0 flex-1"><span className="font-mono text-xs">{o.number}</span> · <span className="text-sm">{o.supplier}</span><br /><span className="text-xs text-muted-foreground">{date(o.placedAt)}{o.deliveryDate ? ` · ${t("deliveryOn", { date: date(o.deliveryDate) })}` : ""}{o.eta ? ` · ${t("eta", { time: date(o.eta, true) })}` : ""}</span></span>
            <span className="text-right text-sm"><span className="font-semibold tabular-nums">{money(o.total)}</span><br /><span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{t(`orderStatus.${o.status}`)}</span></span>
            <ChevronDown className={cn("size-4 transition-transform", open === o.id && "rotate-180")} />
          </button>
          {open === o.id && <ul className="mt-2 space-y-1 border-t pt-2 text-sm">{o.lines.map((l, i) => <li key={i} className="flex justify-between gap-2"><span className="min-w-0 truncate">{l.qty} × {l.name} <span className="text-xs text-muted-foreground">{l.packaging}</span></span><span className="tabular-nums">{money(l.net)}</span></li>)}</ul>}
        </li>
      ))}
    </ul>
  );
}

function Invoices({ t, invoices, money, date, online }: { t: T; invoices: NonNullable<Snap["buy"]>["invoices"]; money: (n: number) => string; date: (d: string) => string; online: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  if (!invoices.length) return <p className="text-sm text-muted-foreground">{t("noInvoices")}</p>;
  const openDoc = async (url: string) => {
    setMsg(null);
    const blob = await cachedDoc(url);
    if (blob) window.open(blob, "_blank");
    else if (online) window.open(url, "_blank");
    else setMsg(t("pdfNotSaved"));
  };
  return (
    <div className="space-y-2">
      {msg && <p className="text-sm text-destructive" role="alert">{msg}</p>}
      <ul className="divide-y rounded-xl border bg-card" data-testid="offline-invoices">
        {invoices.map((i) => (
          <li key={i.id} className="flex items-center gap-3 p-3">
            <FileText className="size-5 text-muted-foreground" />
            <span className="min-w-0 flex-1"><span className="font-mono text-xs">{i.number}</span><br /><span className="text-xs text-muted-foreground">{i.issuedAt ? date(i.issuedAt) : ""}{i.dueAt ? ` · ${t("dueOn", { date: date(i.dueAt) })}` : ""}</span></span>
            <span className="font-semibold tabular-nums">{money(i.total)}</span>
            <Button size="sm" variant="outline" onClick={() => void openDoc(i.pdf)} data-testid="offline-pdf">PDF</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── driver: today's route ───────────────────────────────────────────────────

const NEXT: Record<string, string> = { "delivery.step:PICK_UP": "PICKED_UP", "delivery.step:START": "OUT_FOR_DELIVERY", "delivery.complete": "DELIVERED", "delivery.fail": "FAILED" };

function RouteTab({ t, snap, since }: { t: T; snap: Snap; since: OutboxEntry[] }) {
  const d = snap.driver!;
  // what was done on this phone after the data was saved
  const local = new Map<string, string>();
  for (const e of since) {
    const id = (e.data as { deliveryId?: string }).deliveryId;
    const to = NEXT[e.kind === "delivery.step" ? `${e.kind}:${(e.data as { step?: string }).step}` : e.kind];
    if (id && to) local.set(id, to);
  }
  const stops = d.stops.map((s) => ({ ...s, status: local.get(s.deliveryId) ?? s.status }));
  const [open, setOpen] = useState<string | null>(stops.find((s) => s.status !== "DELIVERED")?.deliveryId ?? null);
  const [form, setForm] = useState<{ id: string; kind: "done" | "fail" } | null>(null);
  const done = stops.filter((s) => s.status === "DELIVERED").length;
  if (!stops.length) return <p className="text-sm text-muted-foreground">{t("noStops")}</p>;
  const step = (s: Stop, stepKind: "PICK_UP" | "START") => void queue(snap.user.id, "driver", "delivery.step", { deliveryId: s.deliveryId, step: stepKind }, `${t(stepKind === "PICK_UP" ? "pickedUp" : "onMyWay")} · ${s.number}`);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground" data-testid="route-progress">{t("routeProgress", { done, total: stops.length })}</p>
      <ol className="space-y-2" data-testid="offline-stops">
        {stops.map((s, i) => (
          <li key={s.deliveryId} className={cn("rounded-xl border bg-card", s.status === "DELIVERED" && "opacity-70")} data-testid="offline-stop" data-delivery={s.deliveryId} data-status={s.status}>
            <button className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setOpen(open === s.deliveryId ? null : s.deliveryId)}>
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold", s.status === "DELIVERED" ? "bg-[color:var(--success,#16a34a)] text-white" : s.status === "FAILED" ? "bg-destructive text-white" : "bg-primary text-primary-foreground")}>{s.status === "DELIVERED" ? <Check className="size-4" /> : i + 1}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{s.customer}</span><span className="block truncate text-xs text-muted-foreground">{s.address}</span></span>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{t(`stopStatus.${s.status}`)}</span>
            </button>
            {open === s.deliveryId && (
              <div className="space-y-3 border-t p-3 text-sm">
                <p className="font-mono text-xs">{s.number} · {s.supplier}</p>
                <div className="flex flex-wrap gap-2">
                  {s.phone && <a href={`tel:${s.phone}`} className="inline-flex items-center gap-1 rounded-md border px-2 py-1"><Phone className="size-4" /> {s.contact ?? s.phone}</a>}
                  <a href={s.lat != null && s.lng != null ? `geo:${s.lat},${s.lng}?q=${s.lat},${s.lng}` : `geo:0,0?q=${encodeURIComponent(s.address)}`} className="inline-flex items-center gap-1 rounded-md border px-2 py-1"><MapPin className="size-4" /> {t("map")}</a>
                </div>
                {s.note && <p className="rounded-md bg-muted px-2 py-1 text-xs">{s.note}</p>}
                <ul className="space-y-0.5">{s.items.map((it, k) => <li key={k}>{it.qty} × {it.name} <span className="text-xs text-muted-foreground">{it.packaging}</span></li>)}</ul>
                <div className="flex flex-wrap gap-2">
                  {(s.status === "ASSIGNED" || s.status === "FAILED") && <Button onClick={() => step(s, "PICK_UP")} data-testid="stop-pickup"><Package className="size-4" /> {t("pickedUp")}</Button>}
                  {s.status === "PICKED_UP" && <Button onClick={() => step(s, "START")} data-testid="stop-start"><Truck className="size-4" /> {t("onMyWay")}</Button>}
                  {s.status === "OUT_FOR_DELIVERY" && d.canPod && <Button onClick={() => setForm({ id: s.deliveryId, kind: "done" })} data-testid="stop-delivered"><Check className="size-4" /> {t("delivered")}</Button>}
                  {(s.status === "PICKED_UP" || s.status === "OUT_FOR_DELIVERY") && <Button variant="outline" onClick={() => setForm({ id: s.deliveryId, kind: "fail" })} data-testid="stop-failed"><AlertTriangle className="size-4" /> {t("couldntDeliver")}</Button>}
                </div>
                {form?.id === s.deliveryId && (form.kind === "done"
                  ? <DeliveredForm t={t} items={s.empties ?? []} onCancel={() => setForm(null)} onSave={async (v) => { await queue(snap.user.id, "driver", "delivery.complete", { deliveryId: s.deliveryId, ...v }, `${t("delivered")} · ${s.number}`); setForm(null); }} />
                  : <FailedForm t={t} reasons={d.reasons} onCancel={() => setForm(null)} onSave={async (v) => { await queue(snap.user.id, "driver", "delivery.fail", { deliveryId: s.deliveryId, ...v }, `${t("couldntDeliver")} · ${s.number}`); setForm(null); }} />)}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

const where = () => new Promise<{ lat?: number; lng?: number }>((resolve) => {
  if (!navigator.geolocation) return resolve({});
  navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve({}), { timeout: 4000, maximumAge: 120_000 });
});

function SignaturePad({ onChange, label }: { onChange: (dataUrl: string | null) => void; label: string }) {
  const c = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const used = useRef(false);
  useEffect(() => {
    const cv = c.current!;
    const ratio = window.devicePixelRatio || 1;
    cv.width = cv.offsetWidth * ratio; cv.height = cv.offsetHeight * ratio;
    const ctx = cv.getContext("2d")!;
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.strokeStyle = "#111827";
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height);
  }, []);
  const pos = (e: React.PointerEvent) => { const r = c.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between"><Label>{label}</Label><button type="button" className="text-xs text-primary" onClick={() => { const cv = c.current!; const ctx = cv.getContext("2d")!; ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height); used.current = false; onChange(null); }}>✕</button></div>
      <canvas ref={c} className="h-36 w-full touch-none rounded-lg border bg-white" data-testid="signature-pad"
        onPointerDown={(e) => { drawing.current = true; const [x, y] = pos(e); const ctx = c.current!.getContext("2d")!; ctx.beginPath(); ctx.moveTo(x, y); (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!drawing.current) return; const [x, y] = pos(e); const ctx = c.current!.getContext("2d")!; ctx.lineTo(x, y); ctx.stroke(); used.current = true; }}
        onPointerUp={() => { drawing.current = false; if (used.current) onChange(c.current!.toDataURL("image/png")); }} />
    </div>
  );
}

function DeliveredForm({ t, items, onSave, onCancel }: { t: T; items: StopItem[]; onSave: (v: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const tr = useTranslations("returnables");
  const el = { emptiesTaken: tr("emptiesTaken"), customerHolds: tr("customerHolds"), swapForFull: tr("swapForFull"), expectedBack: tr("expectedBack"), emptiesHint: tr("emptiesHint") };
  // Phase 40: empties taken back at the stop, sent with the delivery
  const [empties, setEmpties] = useState<Record<string, number>>(Object.fromEntries(items.map((i) => [i.typeId, i.kind === "EXCHANGE" ? Math.min(i.fullOut, i.held) : 0])));
  const [name, setName] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-3 rounded-lg border p-3" data-testid="delivered-form" onSubmit={async (e) => {
      e.preventDefault();
      if (name.trim().length < 2) return setErr(t("needName"));
      if (!sig && !photo) return setErr(t("needProof"));
      setBusy(true);
      await onSave({ recipientName: name.trim(), signature: sig, photos: photo ? [photo] : [], note: note || null, ...(items.length ? { empties } : {}), ...(await where()) });
      setBusy(false);
    }}>
      <div className="space-y-1"><Label htmlFor="pod-name">{t("recipient")}</Label><Input id="pod-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="pod-name" /></div>
      <SignaturePad label={t("signature")} onChange={setSig} />
      <PhotoInput t={t} value={photo} onChange={setPhoto} />
      <EmptiesCounter l={el} items={items} value={empties} onChange={setEmpties} />
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("noteOptional")} maxLength={500} />
      {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy} data-testid="pod-save"><Check className="size-4" /> {t("saveDelivered")}</Button><Button type="button" variant="ghost" onClick={onCancel}>{t("cancel")}</Button></div>
    </form>
  );
}

function FailedForm({ t, reasons, onSave, onCancel }: { t: T; reasons: string[]; onSave: (v: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const [reason, setReason] = useState(reasons[0] ?? "OTHER");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-3 rounded-lg border p-3" data-testid="failed-form" onSubmit={async (e) => {
      e.preventDefault();
      if (reason === "OTHER" && !note.trim()) return setErr(t("needWhat"));
      await onSave({ reasonCode: reason, note: note || null, photo, ...(await where()) });
    }}>
      <Select value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t("whyLabel")} data-testid="fail-reason">{reasons.map((r) => <option key={r} value={r}>{t(`reason.${r}`)}</option>)}</Select>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("noteOptional")} maxLength={500} />
      <PhotoInput t={t} value={photo} onChange={setPhoto} />
      {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
      <div className="flex gap-2"><Button type="submit" variant="destructive" data-testid="fail-save">{t("saveFailed")}</Button><Button type="button" variant="ghost" onClick={onCancel}>{t("cancel")}</Button></div>
    </form>
  );
}

function PhotoInput({ t, value, onChange }: { t: T; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-2 text-sm hover:bg-accent">
        <Camera className="size-4" /> {value ? t("photoAgain") : t("photo")}
        <input type="file" accept="image/*" capture="environment" className="sr-only" data-testid="pod-photo" onChange={async (e) => { const f = e.target.files?.[0]; if (f) onChange(await shrinkPhoto(f).catch(() => null)); }} />
      </label>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {value && <img src={value} alt="" className="size-12 rounded-md object-cover" />}
    </div>
  );
}

// ── supplier: picking ───────────────────────────────────────────────────────

function PickTab({ t, snap, since }: { t: T; snap: Snap; since: OutboxEntry[] }) {
  const lists = snap.vendor!.pickLists;
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [shortFor, setShortFor] = useState<string | null>(null);
  const list = lists.find((l) => l.id === listId);
  const lines = useMemo(() => {
    if (!list) return [];
    const extra = new Map<string, { add: number; set?: number; short?: string }>();
    for (const e of since) {
      const d = e.data as { lineId?: string; qty?: number; found?: number; reason?: string };
      if (!d.lineId) continue;
      const x = extra.get(d.lineId) ?? { add: 0 };
      if (e.kind === "pick.scan") x.add += d.qty ?? 1;
      if (e.kind === "pick.confirm") x.set = d.qty;
      if (e.kind === "pick.short") { x.short = d.reason; x.set = d.found; }
      extra.set(d.lineId, x);
    }
    return list.lines.map((l) => {
      const x = extra.get(l.id);
      const picked = x?.set != null ? x.set : Math.min(l.qty, l.pickedQty + (x?.add ?? 0));
      return { ...l, pickedQty: picked, shortReason: x?.short ?? l.shortReason };
    });
  }, [list, since]);
  if (!lists.length) return <p className="text-sm text-muted-foreground">{t("noPickLists")}</p>;
  const doneN = lines.filter((l) => l.pickedQty >= l.qty || l.shortReason).length;
  const onCode = (raw: string) => {
    const code = raw.trim();
    const open = lines.filter((l) => l.pickedQty < l.qty && !l.shortReason && !l.blocked);
    const batch = /^FIR:B:([^:]+)$/i.exec(code)?.[1];
    const line = batch ? open.find((l) => l.batchId === batch) ?? (snap.vendor!.batchIds.includes(batch) ? null : undefined)
      : open.find((l) => l.lotCode && l.lotCode.toLowerCase() === code.toLowerCase()) ?? open.find((l) => !l.lotCode && (l.gtin === code || l.sku?.toLowerCase() === code.toLowerCase()));
    if (line) {
      void queue(snap.user.id, "vendor", "pick.scan", { lineId: line.id, code, qty: 1 }, `${t("picked")} · ${line.product} (${line.bin ?? "—"})`);
      setMsg({ ok: true, text: t("pickOk", { product: line.product, n: line.pickedQty + 1, qty: line.qty }) });
    } else {
      const lotNeeded = !batch && open.some((l) => l.lotCode && l.gtin === code);
      if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
      setMsg({ ok: false, text: lotNeeded ? t("pickLotNeeded") : line === null ? t("pickWrongLot") : t("pickWrong") });
    }
  };
  return (
    <div className="space-y-3">
      {lists.length > 1 && <Select value={listId} onChange={(e) => setListId(e.target.value)} aria-label={t("pickList")}>{lists.map((l) => <option key={l.id} value={l.id}>{l.number} · {l.warehouse}</option>)}</Select>}
      {list && <p className="text-sm"><span className="font-mono">{list.number}</span> · {list.warehouse} · <span data-testid="pick-progress">{t("pickProgress", { done: doneN, total: lines.length })}</span></p>}
      <Scanner onCode={onCode} testId="offline-pick-scan" placeholder={t("scanPlaceholder")} />
      {msg && <p className={cn("rounded-md px-3 py-2 text-sm", msg.ok ? "bg-[color:var(--success,#16a34a)]/10" : "bg-destructive/10 text-destructive")} role="status" data-testid="pick-msg">{msg.text}</p>}
      <ul className="divide-y rounded-xl border bg-card" data-testid="offline-pick-lines">
        {lines.map((l) => {
          const done = l.pickedQty >= l.qty || !!l.shortReason;
          return (
            <li key={l.id} className={cn("space-y-2 p-3", done && "opacity-70")} data-testid="offline-pick-line" data-done={done}>
              <div className="flex items-start gap-3">
                <span className="rounded-md bg-secondary px-2 py-1 font-mono text-sm font-semibold">{l.bin ?? "—"}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{l.product}</span><span className="block text-xs text-muted-foreground">{l.packaging}{l.lotCode ? ` · ${t("lot", { lot: l.lotCode })}` : ""}{l.expiresOn ? ` · ${l.expiresOn}` : ""} · {l.orderNumber}</span></span>
                <span className="text-right font-semibold tabular-nums">{l.pickedQty}/{l.qty}{l.shortReason && <span className="block text-xs font-normal text-destructive">{t("short")}</span>}</span>
              </div>
              {l.blocked && <p className="text-xs text-destructive">{t("blockedLot")}</p>}
              {!done && !l.blocked && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setMsg(null); void queue(snap.user.id, "vendor", "pick.confirm", { lineId: l.id, qty: l.qty }, `${t("allPicked")} · ${l.product}`); }} data-testid="pick-all"><Check className="size-4" /> {t("allPicked")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShortFor(shortFor === l.id ? null : l.id)}>{t("reportShort")}</Button>
                </div>
              )}
              {shortFor === l.id && <ShortForm t={t} max={l.qty - 1} onSave={(found, reason) => { void queue(snap.user.id, "vendor", "pick.short", { lineId: l.id, found, reason }, `${t("short")} · ${l.product}`); setShortFor(null); }} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ShortForm({ t, max, onSave }: { t: T; max: number; onSave: (found: number, reason: string) => void }) {
  const [found, setFound] = useState(0);
  const [reason, setReason] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2 rounded-md border p-2" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) onSave(found, reason.trim()); }}>
      <div className="space-y-1"><Label htmlFor="sh-found">{t("found")}</Label><Input id="sh-found" type="number" min={0} max={max} value={found} onChange={(e) => setFound(Math.max(0, Math.min(max, Number(e.target.value) || 0)))} className="h-9 w-20" /></div>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("shortReason")} className="h-9 min-w-40 flex-1" required />
      <Button size="sm" type="submit">{t("save")}</Button>
    </form>
  );
}

function VendorOrders({ t, orders, date }: { t: T; orders: NonNullable<Snap["vendor"]>["orders"]; date: (d: string) => string }) {
  if (!orders.length) return <p className="text-sm text-muted-foreground">{t("noOrders")}</p>;
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {orders.map((o) => (
        <li key={o.id} className="space-y-1 p-3 text-sm">
          <div className="flex items-center gap-2"><span className="font-mono text-xs">{o.number}</span><span className="min-w-0 flex-1 truncate">{o.buyer}</span><span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{t(`orderStatus.${o.status}`)}</span></div>
          <p className="text-xs text-muted-foreground">{date(o.placedAt)}{o.deliveryDate ? ` · ${t("deliveryOn", { date: date(o.deliveryDate) })}` : ""}</p>
          <p className="text-xs">{o.lines.map((l) => `${l.qty} × ${l.name}`).join(" · ")}</p>
        </li>
      ))}
    </ul>
  );
}

// ── outbox ──────────────────────────────────────────────────────────────────

type Change = { offerId: string; name: string; was: number; now: number; pct: number };
type Gone = { offerId: string; name: string; qty: number; available: number; why: string };

function OutboxTab({ t, entries, online, userId, money, date }: { t: T; entries: OutboxEntry[]; online: boolean; userId: string; money: (n: number) => string; date: (d: string, time?: boolean) => string }) {
  const [busy, setBusy] = useState(false);
  const sorted = [...entries].sort((a, b) => b.at.localeCompare(a.at));
  if (!sorted.length) return <p className="text-sm text-muted-foreground" data-testid="outbox-empty">{t("outboxEmpty")}</p>;
  const retry = async (e: OutboxEntry, data?: Record<string, unknown>) => { await putEntry({ ...e, data: data ?? e.data, state: "WAITING", error: undefined, result: undefined }); void flush(userId); };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="flex-1 text-muted-foreground">{online ? t("outboxOnline") : t("outboxOffline")}</span>
        {online && <Button size="sm" variant="outline" disabled={busy} onClick={async () => { setBusy(true); await flush(userId); setBusy(false); }} data-testid="outbox-send"><RefreshCw className={cn("size-4", busy && "animate-spin")} /> {t("sendNow")}</Button>}
      </div>
      <ul className="space-y-2" data-testid="outbox">
        {sorted.map((e) => {
          const r = e.result as { number?: string; changes?: Change[]; unavailable?: Gone[]; left?: Gone[]; outcome?: string; approval?: unknown } | undefined;
          return (
            <li key={e.clientId} className="space-y-2 rounded-xl border bg-card p-3 text-sm" data-testid="outbox-entry" data-state={e.state} data-kind={e.kind}>
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1"><span className="block font-medium">{e.title}</span><span className="block text-xs text-muted-foreground">{date(e.at, true)}</span></span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs", e.state === "DONE" ? "bg-[color:var(--success,#16a34a)]/15 text-[color:var(--success,#16a34a)]" : e.state === "FAILED" ? "bg-destructive/15 text-destructive" : e.state === "NEEDS_CONFIRM" ? "bg-warning/25" : "bg-muted")}>{t(`state.${e.state}`)}</span>
              </div>
              {e.state === "DONE" && r?.number && <p data-testid="outbox-number">{r.approval ? t("doneApproval", { number: r.number }) : t("doneOrder", { number: r.number })}</p>}
              {e.state === "DONE" && r?.left && r.left.length > 0 && <p className="text-xs text-muted-foreground">{t("leftOut", { names: r.left.map((g) => g.name).join(", ") })}</p>}
              {e.state === "NEEDS_CONFIRM" && (
                <div className="space-y-2" data-testid="outbox-confirm">
                  <p>{t("changedTitle")}</p>
                  {r?.changes?.length ? <ul className="space-y-0.5">{r.changes.map((c) => <li key={c.offerId} className="flex justify-between gap-2"><span className="min-w-0 truncate">{c.name}</span><span className="tabular-nums">{money(c.was)} → <b>{money(c.now)}</b> ({c.pct > 0 ? "+" : ""}{c.pct} %)</span></li>)}</ul> : null}
                  {r?.unavailable?.length ? <ul className="space-y-0.5 text-destructive">{r.unavailable.map((g) => <li key={g.offerId}>{g.name}: {t(`why.${g.why}`, { n: g.available })}</li>)}</ul> : null}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => void retry(e, { ...e.data, accept: true })} data-testid="outbox-accept"><Check className="size-4" /> {t("orderAnyway")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => void removeEntry(e.clientId)}><Trash2 className="size-4" /> {t("remove")}</Button>
                  </div>
                </div>
              )}
              {e.state === "FAILED" && (
                <div className="space-y-2">
                  <p className="text-destructive" data-testid="outbox-error">{r?.outcome ? t(`pickOutcome.${r.outcome}`) : e.error}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void retry(e)}><RefreshCw className="size-4" /> {t("tryAgain")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => void removeEntry(e.clientId)}><Trash2 className="size-4" /> {t("remove")}</Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
