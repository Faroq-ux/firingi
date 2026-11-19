"use client";
/**
 * Phase 47 — the till. Works on a phone, a tablet, an Android POS terminal or a PC with a receipt printer:
 * tap or scan items (barcodes, scale labels, loyalty cards), weighed items, discounts (a manager's PIN above the
 * limit), cash / card / MB WAY / points, split payments, change, the guest's tax id, a printed or e-mailed receipt
 * with QR, open tables and kitchen tickets, shift X / Z, cash in / out. Without internet it keeps selling from its
 * saved snapshot and sends the sales when back online (stored once each).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { AlertTriangle, Banknote, ChefHat, CloudOff, CreditCard, LockKeyhole, Mail, Minus, Plus, Printer, RefreshCw, Scale, Search, ShoppingCart, Smartphone, Star, Trash2, User, UtensilsCrossed, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Scanner } from "@/components/warehouse/scanner";
import { cn } from "@/lib/utils";
import { CountUp } from "@/components/motion/count-up";
import { LiveDot } from "@/components/motion/shapes";
import { parseWeightLabel } from "@/lib/catch-weight";
import { pointsFor, pointsValue, receiptNumber, saleTotals, settle } from "@/lib/pos";
import { flush, kvGet, kvSet, newClientId, outbox, OUTBOX_EVENT, queue } from "@/lib/offline/store";
import type { TillSnapshot } from "@/server/pos/service";
import { cashMoveAction, closeShiftAction, deleteTicketAction, emailReceiptAction, openShiftAction, posSaleAction, saveTicketAction, shiftReportAction, tillSnapshotAction } from "@/server/actions/pos";

type Item = TillSnapshot["items"][number];
type Line = { key: string; itemId: string | null; name: string; qty: number; unitPrice: number; vatRate: number; discountPct: number; byWeight: boolean; restriction: string | null; kitchen: boolean };
type Pay = { method: "CASH" | "CARD" | "MBWAY" | "POINTS" | "OTHER"; amount: number; tendered?: number; ref?: string };
type Member = TillSnapshot["members"][number];
type Done = { saleId: string | null; number: string; fiscalNumber: string | null; fiscalStatus: string; token: string | null; offline: boolean; lines: Line[]; payments: Pay[]; totals: ReturnType<typeof saleTotals>; change: string; at: string; member: Member | null; pointsEarned: number; taxId: string; email: string; table: string | null };

const snapKey = (portal: string) => `pos:snap:${portal}`;
const nKey = (shiftId: string) => `pos:n:${shiftId}`;
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const isNetwork = (e: unknown) => e instanceof TypeError || (e instanceof Error && /fetch|network|Failed to/i.test(e.message));

export function Till({ portal, initial, locale }: { portal: "vendor" | "buy"; initial: TillSnapshot | null; locale: string }) {
  const t = useTranslations("pos");
  const [snap, setSnap] = useState<TillSnapshot | null>(initial);
  const [online, setOnline] = useState(true);
  const [lines, setLines] = useState<Line[]>([]);
  const [saleDisc, setSaleDisc] = useState(0);
  const [member, setMember] = useState<Member | null>(null);
  const [taxId, setTaxId] = useState("");
  const [email, setEmail] = useState("");
  const [table, setTable] = useState<{ id: string | null; label: string; sentLines: number } | null>(null);
  const [cat, setCat] = useState<string>("");
  const [q, setQ] = useState("");
  const [modal, setModal] = useState<null | { kind: "pay" } | { kind: "weigh"; item: Item } | { kind: "line"; key: string } | { kind: "pin"; reason: string; then: (userId: string) => void } | { kind: "receipt"; done: Done } | { kind: "report"; report: Record<string, unknown>; z: boolean } | { kind: "cash"; mode: "PAY_IN" | "PAY_OUT" | "NO_SALE" } | { kind: "close" } | { kind: "tables" } | { kind: "free" } | { kind: "guest" }>(null);
  const [approvedBy, setApprovedBy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [busy, setBusy] = useState(false);
  const userId = snap?.user.id ?? "";

  // ── snapshot: keep the latest one on the device ──
  const refresh = useCallback(async (registerId?: string | null) => {
    try {
      const r = await tillSnapshotAction({ registerId: registerId ?? snap?.register?.id ?? null });
      if (r.ok && r.data) { setSnap(r.data as TillSnapshot); await kvSet(snapKey(portal), r.data); await kvSet("lastPortal", portal); }
    } catch { /* offline: keep the saved one */ }
  }, [portal, snap?.register?.id]);
  useEffect(() => {
    (async () => {
      if (initial) { await kvSet(snapKey(portal), initial).catch(() => null); return; }
      const saved = await kvGet<TillSnapshot>(snapKey(portal)).catch(() => undefined);
      if (saved) setSnap(saved);
    })();
  }, [initial, portal]);
  const countWaiting = useCallback(async () => setWaiting((await outbox().catch(() => [])).filter((e) => e.kind.startsWith("pos.sale") && e.state !== "DONE").length), []);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => { setOnline(true); if (userId) void flush(userId).then(countWaiting); };
    const off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off); window.addEventListener(OUTBOX_EVENT, countWaiting);
    void countWaiting();
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); window.removeEventListener(OUTBOX_EVENT, countWaiting); };
  }, [userId, countWaiting]);

  const s = snap?.settings;
  const dec = s?.decimals ?? 2;
  const money = useCallback((n: number | string) => new Intl.NumberFormat(locale, { style: "currency", currency: s?.currency ?? "EUR", minimumFractionDigits: dec, maximumFractionDigits: dec }).format(Number(n)), [locale, s?.currency, dec]);
  const totals = useMemo(() => saleTotals(lines, saleDisc, dec), [lines, saleDisc, dec]);
  const cats = useMemo(() => [...new Set((snap?.items ?? []).map((i) => i.category ?? "").filter(Boolean))], [snap?.items]);
  const shown = useMemo(() => {
    const all = snap?.items ?? [];
    const k = q.trim().toLowerCase();
    if (k) return all.filter((i) => i.name.toLowerCase().includes(k) || i.barcode === k || i.plu === k).slice(0, 60);
    return all.filter((i) => i.quick && (!cat || i.category === cat));
  }, [snap?.items, q, cat]);
  const stale = snap ? Date.now() - new Date(snap.at).getTime() > (s?.offlineHours ?? 24) * 3600_000 : false;
  const tooMany = waiting >= (s?.offlineMaxSales ?? 500);
  const canSell = !!snap?.shift && !s?.blocked && !(!online && (stale || tooMany || !s?.features.offline));
  const flash = (tone: "ok" | "err", text: string) => { setMsg({ tone, text }); setTimeout(() => setMsg(null), 4000); };

  // ── cart ──
  const add = (it: Item, qty = 1) => {
    if (it.byWeight && qty === 1) { setModal({ kind: "weigh", item: it }); return; }
    setLines((ls) => {
      const same = !it.byWeight && ls.find((l) => l.itemId === it.id && !l.discountPct);
      if (same) return ls.map((l) => (l === same ? { ...l, qty: l.qty + qty } : l));
      return [...ls, { key: newClientId(), itemId: it.id, name: it.name, qty, unitPrice: it.price, vatRate: it.vatRate, discountPct: 0, byWeight: it.byWeight, restriction: it.restriction, kitchen: it.kitchen }];
    });
  };
  const onScan = (raw: string) => {
    const code = raw.trim();
    if (!snap || !code) return;
    const it = snap.items.find((i) => i.barcode === code);
    if (it) return add(it, it.byWeight ? 1 : 1);
    if (s?.features.scale) {
      const w = parseWeightLabel(code, { ...snap.settings.scale, gramsPerUnit: 1 });
      if (w && w.kind === "EAN13") {
        const byPlu = snap.items.find((i) => i.plu && Number(i.plu) === Number(w.item));
        if (byPlu) { add(byPlu, Math.round(w.kg * 1000) / 1000); return; }
      }
    }
    const m = snap.members.find((x) => x.code === code || x.phone?.replace(/\D/g, "") === code.replace(/\D/g, ""));
    if (m) { setMember(m); flash("ok", t("memberAdded", { name: m.name })); return; }
    flash("err", t("notFound", { code }));
  };
  const clear = () => { setLines([]); setSaleDisc(0); setMember(null); setTaxId(""); setEmail(""); setTable(null); setApprovedBy(null); };
  const ageNeeded = !!s?.features.ageCheck && lines.some((l) => l.restriction);
  const needsManager = Math.max(saleDisc, ...lines.map((l) => l.discountPct), 0) > (s?.discountLimit ?? 10) && !snap?.user.manager && !approvedBy;

  /** A manager's PIN, checked on this device (works offline). */
  const askManager = (reason: string, then: (uid: string) => void) => setModal({ kind: "pin", reason, then });

  // ── the sale ──
  const nextN = async () => {
    const shift = snap!.shift!;
    const saved = (await kvGet<number>(nKey(shift.id)).catch(() => undefined)) ?? 0;
    const n = Math.max(saved, shift.sold) + 1;
    await kvSet(nKey(shift.id), n).catch(() => null);
    return n;
  };
  const complete = async (pays: Pay[], ageChecked: boolean) => {
    if (!snap?.shift || !snap.register) return;
    setBusy(true);
    const n = await nextN();
    const pointsUsed = pays.filter((p) => p.method === "POINTS").reduce((a, p) => a + Math.round(p.amount / (s!.pointValue || 1)), 0);
    const input = {
      clientId: newClientId(), registerId: snap.register.id, shiftId: snap.shift.id, n, soldAt: new Date().toISOString(),
      lines: lines.map((l) => ({ itemId: l.itemId, name: l.name, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, vatRate: l.vatRate })),
      saleDiscountPct: saleDisc, payments: pays.map((p) => ({ method: p.method, amount: p.amount, tendered: p.tendered ?? null, ref: p.ref ?? null })),
      customerTaxId: taxId || null, customerEmail: email || null, memberId: member?.id ?? null, pointsUsed, ageChecked, tableRef: table?.label ?? null, approvedById: approvedBy, ticketId: table?.id ?? null,
    };
    const st = settle(totals.gross, pays, dec);
    const base: Done = { saleId: null, number: receiptNumber(snap.register.code, snap.shift.number, n), fiscalNumber: null, fiscalStatus: s!.stage === "PROVIDER" ? "PENDING" : "NOT_REQUIRED", token: null, offline: true, lines, payments: pays, totals, change: st.change, at: input.soldAt, member, pointsEarned: member && s!.loyaltyOn ? pointsFor(Number(totals.gross) - pointsUsed * s!.pointValue, s!.pointsPerUnit) : 0, taxId, email, table: table?.label ?? null };
    let done = base;
    try {
      if (!navigator.onLine) throw new TypeError("offline");
      const r = await posSaleAction(input);
      if (!r.ok) { setBusy(false); flash("err", r.error ?? t("error")); return; }
      const x = r.data as { id: string; number: string; fiscalNumber: string | null; fiscalStatus: string; receiptToken: string; pointsEarned: number };
      done = { ...base, saleId: x.id, number: x.number, fiscalNumber: x.fiscalNumber, fiscalStatus: x.fiscalStatus, token: x.receiptToken, offline: false, pointsEarned: x.pointsEarned };
    } catch (e) {
      if (!isNetwork(e)) { setBusy(false); flash("err", e instanceof Error ? e.message : t("error")); return; }
      await queue(userId, portal, portal === "buy" ? "pos.sale.buy" : "pos.sale", input as unknown as Record<string, unknown>, `${t("sale")} ${base.number} · ${money(totals.gross)}`);
      void countWaiting();
    }
    setSnap((sn) => (sn && sn.shift ? { ...sn, shift: { ...sn.shift, sold: n }, members: member ? sn.members.map((m) => (m.id === member.id ? { ...m, points: m.points - pointsUsed + done.pointsEarned } : m)) : sn.members, tickets: table?.id ? sn.tickets.filter((x) => x.id !== table.id) : sn.tickets } : sn));
    setBusy(false);
    setModal({ kind: "receipt", done });
    clear();
  };

  // ── shift ──
  const [float, setFloat] = useState("0");
  const openShift = async () => {
    if (!snap?.register) return;
    setBusy(true);
    const r = await openShiftAction({ registerId: snap.register.id, openingFloat: Number(float.replace(",", ".")) || 0 }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { flash("err", r?.error ?? t("needOnline")); return; }
    await refresh();
  };
  const report = async (z = false) => {
    if (!snap?.shift) return;
    const r = await shiftReportAction({ id: snap.shift.id }).catch(() => null);
    if (!r?.ok) { flash("err", r?.error ?? t("needOnline")); return; }
    setModal({ kind: "report", report: (r.data as { report: Record<string, unknown> }).report, z });
  };

  // ── open tables (restaurants) ──
  const park = async (label: string) => {
    if (!snap?.register || !lines.length) return;
    const r = await saveTicketAction({ id: table?.id ?? null, registerId: snap.register.id, label, lines: lines as never, sentLines: table?.sentLines ?? 0 }).catch(() => null);
    if (!r?.ok) { flash("err", r?.error ?? t("needOnline")); return; }
    flash("ok", t("parked", { label }));
    clear();
    await refresh();
  };
  const kitchenTicket = () => {
    const from = table?.sentLines ?? 0;
    const send = lines.slice(from).filter((l) => l.kitchen || !(s?.features.kitchen));
    if (!send.length) { flash("err", t("nothingForKitchen")); return; }
    printHtml(`<h2 style="margin:0">${t("kitchenTicket")}</h2><p>${table?.label ?? ""} · ${new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</p>${send.map((l) => `<p style="font-size:18px;margin:4px 0"><b>${l.byWeight ? l.qty.toFixed(3) + " kg" : l.qty + " ×"}</b> ${escapeHtml(l.name)}</p>`).join("")}`);
    setTable((tb) => ({ id: tb?.id ?? null, label: tb?.label ?? t("counter"), sentLines: lines.length }));
  };

  if (!snap) return <div className="grid min-h-[50vh] place-items-center text-center text-muted-foreground" data-testid="till-empty"><div><CloudOff className="mx-auto mb-2 size-8" />{t("noSnapshot")}</div></div>;
  if (!snap.register) return <div className="rounded-xl border bg-card p-6 text-sm" data-testid="till-no-register">{t("noRegister")}</div>;

  const pending = waiting > 0;
  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col gap-3 lg:flex-row" data-testid="till">
      <style>{`@media print { body * { visibility: hidden !important; } #pos-print, #pos-print * { visibility: visible !important; } #pos-print { position: absolute; left: 0; top: 0; width: 72mm; font: 12px/1.35 ui-monospace, monospace; color: #000; background: #fff; } }`}</style>
      {/* items */}
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm">
          <span className="font-semibold" data-testid="till-register">{snap.register.name} · {snap.register.code}</span>
          {snap.shift ? <Badge variant="secondary" data-testid="till-shift">{t("shiftN", { n: snap.shift.number })}</Badge> : <Badge variant="destructive">{t("noShift")}</Badge>}
          <Badge variant={online ? "success" : "destructive"} data-testid="till-online" className="gap-1.5">{online ? <LiveDot /> : <CloudOff className="size-3" />}{online ? t("online") : t("offline")}</Badge>
          {pending && <Badge variant="secondary" data-testid="till-waiting">{t("waitingSales", { n: waiting })}</Badge>}
          {s?.stage === "NONFISCAL" ? <span className="text-xs text-muted-foreground" data-testid="till-stage">{t("stageNonFiscal")}</span> : <span className="text-xs text-muted-foreground" data-testid="till-stage">{t("stageProvider")}</span>}
          <span className="ml-auto flex flex-wrap gap-1">
            {snap.shift && <Button size="sm" variant="outline" onClick={() => void report(false)} data-testid="till-x">{t("xReport")}</Button>}
            {snap.shift && s?.features.cash && <Button size="sm" variant="outline" onClick={() => setModal({ kind: "cash", mode: "PAY_IN" })} data-testid="till-cash">{t("cash")}</Button>}
            {s?.features.tables && <Button size="sm" variant="outline" onClick={() => setModal({ kind: "tables" })} data-testid="till-tables"><UtensilsCrossed className="size-4" /> {t("tables")} ({snap.tickets.length})</Button>}
            {snap.shift && <Button size="sm" variant="outline" onClick={() => setModal({ kind: "close" })} data-testid="till-close">{t("closeShift")}</Button>}
            <Button size="sm" variant="ghost" onClick={() => void refresh()} aria-label={t("refresh")} data-testid="till-refresh"><RefreshCw className="size-4" /></Button>
          </span>
        </div>
        {s?.blocked && <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" data-testid="till-blocked"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{t("blocked")}</p>}
        {!online && (stale || tooMany) && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" data-testid="till-offline-stop">{stale ? t("offlineTooLong", { h: s?.offlineHours ?? 24 }) : t("offlineTooMany", { n: s?.offlineMaxSales ?? 500 })}</p>}
        {msg && <p className={cn("rounded-lg px-3 py-2 text-sm", msg.tone === "ok" ? "bg-[color:var(--success,#16a34a)]/10" : "bg-destructive/10 text-destructive")} role="status" data-testid="till-msg">{msg.text}</p>}
        {!snap.shift ? (
          <div className="max-w-sm space-y-3 rounded-xl border bg-card p-4" data-testid="till-open">
            <p className="text-sm">{t("openShiftText")}</p>
            <Label htmlFor="float">{t("openingFloat")}</Label>
            <Input id="float" inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} data-testid="till-float" />
            <Button onClick={() => void openShift()} disabled={busy || !online} data-testid="till-open-btn">{t("openShift")}</Button>
          </div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
              <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-8" placeholder={t("searchItems")} value={q} onChange={(e) => setQ(e.target.value)} data-testid="till-search" /></div>
              <Scanner onCode={onScan} autoFocus={false} testId="till-scan" placeholder={t("scanHere")} />
            </div>
            {cats.length > 0 && !q && (
              <div className="flex gap-1 overflow-x-auto pb-1" data-testid="till-cats">
                <button className={cn("shrink-0 rounded-full border px-3 py-1 text-sm", !cat && "bg-primary text-primary-foreground")} onClick={() => setCat("")}>{t("all")}</button>
                {cats.map((c) => <button key={c} className={cn("shrink-0 rounded-full border px-3 py-1 text-sm", cat === c && "bg-primary text-primary-foreground")} onClick={() => setCat(c)}>{c}</button>)}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4" data-testid="till-items">
              {shown.map((i, n) => (
                <button key={`${cat}:${i.id}`} onClick={() => add(i)} disabled={!canSell} className="motion-rise motion-lift flex min-h-20 min-w-0 flex-col justify-between rounded-xl border bg-card p-2 text-left text-sm shadow-sm transition hover:border-primary active:scale-[.96] disabled:opacity-50" style={{ ["--i" as string]: Math.min(n, 16), ...(i.color ? { borderLeft: `6px solid ${i.color}` } : {}) }} data-testid="till-item">
                  <span className="line-clamp-2 break-words font-medium">{i.name}</span>
                  <span className="mt-1 flex items-center justify-between gap-1 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{money(i.price)}{i.byWeight ? " /kg" : ""}</span>
                    <span className="flex shrink-0 gap-1">{i.byWeight && <Scale className="size-3.5" />}{i.restriction && <span className="rounded bg-amber-500/20 px-1">18+</span>}{i.allergens.length > 0 && <span title={i.allergens.join(", ")}>⚠</span>}</span>
                  </span>
                </button>
              ))}
              {shown.length === 0 && <p className="col-span-full py-6 text-center text-sm text-muted-foreground">{t("noItems")}</p>}
            </div>
          </>
        )}
      </section>

      {/* the ticket */}
      <aside className="flex w-full flex-col rounded-xl border bg-card lg:w-[380px] lg:shrink-0" data-testid="till-cart">
        <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
          <ShoppingCart className="size-4" /><span className="font-semibold">{table ? table.label : t("ticket")}</span>
          {member && <Badge variant="secondary" className="ml-auto" data-testid="till-member"><Star className="mr-1 size-3" />{member.name} · {member.points}</Badge>}
          <span className={cn(!member && "ml-auto", "flex gap-1")}>
            {s?.loyaltyOn && <Button size="sm" variant="ghost" onClick={() => setModal({ kind: "guest" })} aria-label={t("guest")} data-testid="till-guest-btn"><User className="size-4" /></Button>}
            {lines.length > 0 && <Button size="sm" variant="ghost" onClick={clear} aria-label={t("clear")} data-testid="till-clear"><Trash2 className="size-4" /></Button>}
          </span>
        </div>
        <ul className="max-h-[45vh] flex-1 divide-y overflow-y-auto lg:max-h-none" data-testid="till-lines">
          {lines.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">{t("emptyTicket")}</li>}
          {lines.map((l, i) => {
            const lt = totals.lines[i];
            return (
              <li key={l.key} className="animate-page flex items-center gap-2 px-3 py-2 text-sm" data-testid="till-line">
                <button className="min-w-0 flex-1 text-left" onClick={() => setModal({ kind: "line", key: l.key })}>
                  <span className="block break-words font-medium">{l.name}</span>
                  <span className="text-xs text-muted-foreground">{l.byWeight ? `${l.qty.toFixed(3)} kg × ${money(l.unitPrice)}` : `${l.qty} × ${money(l.unitPrice)}`}{l.discountPct ? ` · −${l.discountPct}%` : ""}</span>
                </button>
                {!l.byWeight && <span className="flex shrink-0 items-center gap-1">
                  <Button size="icon" variant="outline" className="size-7" onClick={() => setLines((ls) => ls.flatMap((x) => (x.key !== l.key ? [x] : x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : [])))} aria-label="−"><Minus className="size-3" /></Button>
                  <Button size="icon" variant="outline" className="size-7" onClick={() => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: x.qty + 1 } : x)))} aria-label="+"><Plus className="size-3" /></Button>
                </span>}
                <span key={lt.gross} className="motion-flash w-20 shrink-0 rounded text-right font-medium tabular-nums">{money(lt.gross)}</span>
              </li>
            );
          })}
        </ul>
        <div className="space-y-2 border-t p-3 text-sm">
          {Number(totals.discount) > 0 && <div className="flex justify-between text-muted-foreground"><span>{t("discount")}</span><span>−{money(totals.discount)}</span></div>}
          {totals.byRate.map((r) => <div key={r.rate} className="flex justify-between text-xs text-muted-foreground"><span>{t("vatAt", { rate: r.rate })}</span><span>{money(r.vat)}</span></div>)}
          <div className="flex items-baseline justify-between text-lg font-bold"><span>{t("total")}</span><span data-testid="till-total"><CountUp value={Number(totals.gross)} fmt={`money:${s?.currency ?? "EUR"}`} locale={locale} duration={450} /></span></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!lines.length} onClick={() => setSaleDisc((d) => (d ? 0 : 10))} data-testid="till-sale-disc">{saleDisc ? `−${saleDisc}%` : t("discountSale")}</Button>
            {snap.user.manager && <Button variant="outline" size="sm" onClick={() => setModal({ kind: "free" })} data-testid="till-free">{t("freeItem")}</Button>}
            {s?.features.kitchen && <Button variant="outline" size="sm" disabled={!lines.length} onClick={kitchenTicket} data-testid="till-kitchen"><ChefHat className="size-4" /> {t("kitchen")}</Button>}
            {s?.features.tables && <Button variant="outline" size="sm" disabled={!lines.length || !online} onClick={() => { const label = table?.label ?? prompt(t("tableName")) ?? ""; if (label.trim()) void park(label.trim()); }} data-testid="till-park">{t("park")}</Button>}
          </div>
          <Button className={cn("h-12 w-full text-base", lines.length > 0 && canSell && "motion-sheen")} disabled={!lines.length || !canSell || busy} onClick={() => (needsManager ? askManager(t("pinDiscount"), (u) => { setApprovedBy(u); setModal({ kind: "pay" }); }) : setModal({ kind: "pay" }))} data-testid="till-pay">
            <Wallet className="size-5" /> {t("pay")} {money(totals.gross)}
          </Button>
        </div>
      </aside>

      {modal?.kind === "weigh" && <WeighModal t={t} item={modal.item} money={money} onClose={() => setModal(null)} onAdd={(kg) => { setModal(null); setLines((ls) => [...ls, { key: newClientId(), itemId: modal.item.id, name: modal.item.name, qty: kg, unitPrice: modal.item.price, vatRate: modal.item.vatRate, discountPct: 0, byWeight: true, restriction: modal.item.restriction, kitchen: modal.item.kitchen }]); }} />}
      {modal?.kind === "line" && (() => {
        const l = lines.find((x) => x.key === modal.key);
        if (!l) return null;
        return <LineModal t={t} line={l} onClose={() => setModal(null)} onSave={(qty, disc) => { setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty, discountPct: disc } : x))); setModal(null); }} onRemove={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); setModal(null); }} />;
      })()}
      {modal?.kind === "pin" && <PinModal t={t} reason={modal.reason} companyId={snap.company.id} pins={snap.pins} onClose={() => setModal(null)} onOk={(u) => { const then = modal.then; setModal(null); then(u); }} />}
      {modal?.kind === "pay" && <PayModal t={t} snap={snap} gross={Number(totals.gross)} money={money} member={member} ageNeeded={ageNeeded} busy={busy} taxId={taxId} setTaxId={setTaxId} email={email} setEmail={setEmail} onClose={() => setModal(null)} onDone={(p, age) => void complete(p, age)} />}
      {modal?.kind === "receipt" && <ReceiptModal t={t} snap={snap} done={modal.done} money={money} locale={locale} online={online} onClose={() => setModal(null)} />}
      {modal?.kind === "report" && <ReportModal t={t} report={modal.report} money={money} z={modal.z} onClose={() => setModal(null)} />}
      {modal?.kind === "cash" && snap.shift && <CashModal t={t} shiftId={snap.shift.id} manager={snap.user.manager} askManager={askManager} onClose={() => setModal(null)} onDone={(m) => { setModal(null); flash("ok", m); }} />}
      {modal?.kind === "close" && snap.shift && <CloseModal t={t} shiftId={snap.shift.id} money={money} onClose={() => setModal(null)} onClosed={async (z) => { await kvSet(nKey(snap.shift!.id), 0).catch(() => null); setModal({ kind: "report", report: z, z: true }); await refresh(); }} />}
      {modal?.kind === "tables" && <TablesModal t={t} tickets={snap.tickets} onClose={() => setModal(null)} onOpen={(tk) => { setLines(tk.lines as Line[]); setTable({ id: tk.id, label: tk.label, sentLines: tk.sentLines }); setModal(null); }} onDelete={async (id) => { await deleteTicketAction({ id }).catch(() => null); await refresh(); }} />}
      {modal?.kind === "free" && <FreeModal t={t} onClose={() => setModal(null)} onAdd={(name, price, vat) => { setLines((ls) => [...ls, { key: newClientId(), itemId: null, name, qty: 1, unitPrice: price, vatRate: vat, discountPct: 0, byWeight: false, restriction: null, kitchen: false }]); setModal(null); }} />}
      {modal?.kind === "guest" && <GuestModal t={t} members={snap.members} onClose={() => setModal(null)} onPick={(m) => { setMember(m); setModal(null); }} />}
    </div>
  );
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
function printHtml(html: string) {
  const el = document.createElement("div");
  el.id = "pos-print";
  el.innerHTML = html;
  document.body.appendChild(el);
  window.print();
  setTimeout(() => el.remove(), 500);
}

type T = ReturnType<typeof useTranslations>;

function Modal({ title, onClose, children, testId, wide }: { title: string; onClose: () => void; children: React.ReactNode; testId: string; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/50 p-0 sm:place-items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <div className={cn("max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border bg-card p-4 shadow-xl sm:rounded-2xl", wide ? "sm:max-w-2xl" : "sm:max-w-md")}>
        <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-base font-semibold">{title}</h2><Button size="icon" variant="ghost" onClick={onClose} aria-label="×"><X className="size-4" /></Button></div>
        {children}
      </div>
    </div>
  );
}

function Keypad({ value, onChange, testId }: { value: string; onChange: (v: string) => void; testId: string }) {
  const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ",", "0", "⌫"];
  return (
    <div className="grid grid-cols-3 gap-2" data-testid={testId}>
      {keys.map((k) => <Button key={k} type="button" variant="outline" className="h-12 text-lg" onClick={() => onChange(k === "⌫" ? value.slice(0, -1) : k === "," ? (value.includes(",") ? value : `${value || "0"},`) : value === "0" ? k : value + k)}>{k}</Button>)}
    </div>
  );
}
const num = (v: string) => Number(v.replace(",", ".")) || 0;

function WeighModal({ t, item, money, onAdd, onClose }: { t: T; item: Item; money: (n: number) => string; onAdd: (kg: number) => void; onClose: () => void }) {
  const [v, setV] = useState("");
  const kg = Math.round(num(v) * 1000) / 1000;
  return (
    <Modal title={t("weighTitle", { name: item.name })} onClose={onClose} testId="till-weigh">
      <p className="mb-2 text-sm text-muted-foreground">{t("weighText")}</p>
      <div className="mb-2 rounded-lg border bg-muted/40 p-3 text-right text-2xl font-semibold tabular-nums" data-testid="till-weigh-value">{v || "0"} kg</div>
      <Keypad value={v} onChange={setV} testId="till-weigh-pad" />
      <p className="mt-2 text-right text-sm">{money(kg * item.price)}</p>
      <Button className="mt-3 w-full" disabled={kg <= 0} onClick={() => onAdd(kg)} data-testid="till-weigh-add">{t("add")}</Button>
    </Modal>
  );
}

function LineModal({ t, line, onSave, onRemove, onClose }: { t: T; line: Line; onSave: (qty: number, disc: number) => void; onRemove: () => void; onClose: () => void }) {
  const [qty, setQty] = useState(String(line.qty).replace(".", ","));
  const [disc, setDisc] = useState(String(line.discountPct));
  return (
    <Modal title={line.name} onClose={onClose} testId="till-line-edit">
      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="lq">{line.byWeight ? "kg" : t("qty")}</Label><Input id="lq" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="till-line-qty" /></div>
        <div><Label htmlFor="ld">{t("discountPct")}</Label><Input id="ld" inputMode="decimal" value={disc} onChange={(e) => setDisc(e.target.value)} data-testid="till-line-disc" /></div>
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="outline" onClick={onRemove} data-testid="till-line-remove"><Trash2 className="size-4" /> {t("remove")}</Button>
        <Button className="ml-auto" disabled={num(qty) <= 0} onClick={() => onSave(num(qty), Math.min(100, Math.max(0, num(disc))))} data-testid="till-line-save">{t("save")}</Button>
      </div>
    </Modal>
  );
}

function PinModal({ t, reason, companyId, pins, onOk, onClose }: { t: T; reason: string; companyId: string; pins: TillSnapshot["pins"]; onOk: (userId: string) => void; onClose: () => void }) {
  const [v, setV] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const check = async () => {
    for (const p of pins) if (p.manager && (await sha256(`pos-pin:${companyId}:${p.userId}:${v}`)) === p.hash) return onOk(p.userId);
    setErr(t("pinWrong")); setV("");
  };
  return (
    <Modal title={t("pinTitle")} onClose={onClose} testId="till-pin">
      <p className="mb-2 flex items-center gap-2 text-sm"><LockKeyhole className="size-4" />{reason}</p>
      <div className="mb-2 rounded-lg border bg-muted/40 p-3 text-center text-2xl tracking-[.5em]" data-testid="till-pin-value">{"•".repeat(v.length) || " "}</div>
      <Keypad value={v} onChange={(x) => setV(x.replace(/\D/g, "").slice(0, 8))} testId="till-pin-pad" />
      {err && <p className="mt-2 text-sm text-destructive" role="alert">{err}</p>}
      <Button className="mt-3 w-full" disabled={v.length < 4} onClick={() => void check()} data-testid="till-pin-ok">{t("confirm")}</Button>
    </Modal>
  );
}

function PayModal({ t, snap, gross, money, member, ageNeeded, busy, taxId, setTaxId, email, setEmail, onDone, onClose }: {
  t: T; snap: TillSnapshot; gross: number; money: (n: number | string) => string; member: Member | null; ageNeeded: boolean; busy: boolean;
  taxId: string; setTaxId: (v: string) => void; email: string; setEmail: (v: string) => void; onDone: (p: Pay[], age: boolean) => void; onClose: () => void;
}) {
  const s = snap.settings;
  const [pays, setPays] = useState<Pay[]>([]);
  const [entry, setEntry] = useState("");
  const [age, setAge] = useState(false);
  const [ref, setRef] = useState("");
  const st = settle(gross, pays, s.decimals);
  const due = Number(st.due);
  const methods: { m: Pay["method"]; label: string; icon: React.ElementType }[] = [
    ...(s.features.cash ? [{ m: "CASH" as const, label: t("payCash"), icon: Banknote }] : []),
    ...(s.features.card ? [{ m: "CARD" as const, label: t("payCard"), icon: CreditCard }] : []),
    ...(s.features.mbway && snap.company.countryCode === "PT" ? [{ m: "MBWAY" as const, label: "MB WAY", icon: Smartphone }] : []),
    { m: "OTHER" as const, label: t("payOther"), icon: Wallet },
  ];
  const canPoints = !!member && s.loyaltyOn && member.points >= s.minRedeem && !pays.some((p) => p.method === "POINTS");
  const addPay = (m: Pay["method"]) => {
    const amount = entry ? num(entry) : due;
    if (amount <= 0) return;
    if (m === "CASH") setPays((p) => [...p, { method: "CASH", amount: Math.min(amount, due), tendered: amount }]);
    else setPays((p) => [...p, { method: m, amount: Math.min(amount, due), ref: ref || undefined }]);
    setEntry(""); setRef("");
  };
  const usePoints = () => {
    const maxPts = Math.min(member!.points, Math.floor(due / (s.pointValue || 1)));
    const pts = Math.max(0, maxPts);
    if (pts < s.minRedeem) return;
    setPays((p) => [...p, { method: "POINTS", amount: Number(pointsValue(pts, s.pointValue, s.decimals)) }]);
  };
  const quick = [due, ...[5, 10, 20, 50, 100].filter((n) => n > due).slice(0, 3)];
  return (
    <Modal title={t("payTitle", { total: money(gross) })} onClose={onClose} testId="till-pay-modal" wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="rounded-lg border bg-muted/40 p-3"><div className="text-xs text-muted-foreground">{t("due")}</div><div className="text-2xl font-bold tabular-nums" data-testid="till-due">{money(due)}</div></div>
          <Input inputMode="decimal" placeholder={t("amountPlaceholder", { due: money(due) })} value={entry} onChange={(e) => setEntry(e.target.value)} data-testid="till-amount" />
          <div className="flex flex-wrap gap-1">{quick.map((qv) => <Button key={qv} size="sm" variant="outline" onClick={() => setEntry(String(qv).replace(".", ","))}>{money(qv)}</Button>)}</div>
          <div className="grid grid-cols-2 gap-2">
            {methods.map(({ m, label, icon: I }) => <Button key={m} variant="outline" className="h-12" disabled={due <= 0 && m !== "CASH"} onClick={() => addPay(m)} data-testid={`till-pay-${m}`}><I className="size-4" /> {label}</Button>)}
            {canPoints && <Button variant="outline" className="h-12" onClick={usePoints} data-testid="till-pay-POINTS"><Star className="size-4" /> {t("payPoints", { n: member!.points })}</Button>}
          </div>
          <Input placeholder={t("cardRef")} value={ref} onChange={(e) => setRef(e.target.value)} data-testid="till-pay-ref" />
        </div>
        <div className="space-y-2 text-sm">
          <ul className="divide-y rounded-lg border" data-testid="till-payments">
            {pays.length === 0 && <li className="p-3 text-muted-foreground">{t("noPayments")}</li>}
            {pays.map((p, i) => <li key={i} className="flex items-center justify-between gap-2 p-2"><span>{p.method === "CASH" ? `${t("payCash")} (${money(p.tendered ?? p.amount)})` : p.method === "POINTS" ? t("payPointsShort") : p.method}</span><span className="flex items-center gap-1 tabular-nums">{money(p.amount)}<Button size="icon" variant="ghost" className="size-7" onClick={() => setPays((x) => x.filter((_, j) => j !== i))} aria-label={t("remove")}><X className="size-3" /></Button></span></li>)}
          </ul>
          {Number(st.change) > 0 && <p key={st.change} className="animate-pop rounded-lg bg-[color:var(--success,#16a34a)]/10 p-3 text-lg font-semibold" data-testid="till-change">{t("change")}: {money(st.change)}</p>}
          <div><Label htmlFor="tax">{t("taxId")}</Label><Input id="tax" value={taxId} onChange={(e) => setTaxId(e.target.value)} data-testid="till-taxid" /></div>
          {s.emailReceipts && s.features.emailReceipt && <div><Label htmlFor="em">{t("receiptEmail")}</Label><Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="till-email" /></div>}
          {ageNeeded && <label className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-2"><input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} data-testid="till-age" /> <span>{t("ageCheck")}</span></label>}
          <Button className="h-12 w-full text-base" disabled={due > 0 || busy || (ageNeeded && !age)} onClick={() => onDone(pays, age)} data-testid="till-complete">{busy ? <RefreshCw className="size-4 animate-spin" /> : null}{t("complete")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ReceiptModal({ t, snap, done, money, locale, online, onClose }: { t: T; snap: TillSnapshot; done: Done; money: (n: number | string) => string; locale: string; online: boolean; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [mail, setMail] = useState(done.email);
  const [sent, setSent] = useState<string | null>(null);
  const url = done.token ? `${location.origin}/r/${done.token}` : null;
  useEffect(() => { if (url) void QRCode.toDataURL(url, { margin: 1, width: 160 }).then(setQr); }, [url]);
  const ref = useRef<HTMLDivElement>(null);
  const s = snap.settings;
  const print = () => { if (ref.current) printHtml(ref.current.innerHTML); };
  return (
    <Modal title={t("receiptTitle")} onClose={onClose} testId="till-receipt">
      <div className="mb-3 flex items-center gap-3" data-testid="till-done">
        <svg viewBox="0 0 52 52" className="size-12 shrink-0 text-[color:var(--success,#16a34a)]" aria-hidden><circle cx="26" cy="26" r="23" fill="none" stroke="currentColor" strokeWidth="3" pathLength={1} className="motion-draw" /><path d="M15 27l7 7 15-16" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="motion-draw" style={{ animationDelay: "0.45s" }} /></svg>
        <div className="min-w-0"><div className="text-lg font-semibold">{money(done.totals.gross)}</div>{Number(done.change) > 0 && <div className="animate-pop text-sm font-medium">{t("change")}: {money(done.change)}</div>}</div>
      </div>
      <div ref={ref} className="mx-auto max-w-[300px] space-y-1 rounded-lg border bg-white p-3 font-mono text-[12px] leading-snug text-black" data-testid="till-receipt-paper">
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{snap.company.name}</div>
          <div>{snap.company.legalName}</div><div>{snap.company.address}</div><div>{t("taxIdShort")}: {snap.company.taxId}</div>
          {s.receiptHeader && <div style={{ whiteSpace: "pre-wrap" }}>{s.receiptHeader}</div>}
        </div>
        <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
        <div>{done.fiscalNumber ?? done.number}</div>
        <div>{new Date(done.at).toLocaleString(locale)}{done.table ? ` · ${done.table}` : ""}</div>
        {done.taxId && <div>{t("customerTaxId")}: {done.taxId}</div>}
        <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
        {done.lines.map((l, i) => (
          <div key={i}><div>{l.name}</div><div style={{ display: "flex", justifyContent: "space-between" }}><span>{l.byWeight ? `${l.qty.toFixed(3)}kg` : l.qty} x {money(l.unitPrice)}{l.discountPct ? ` -${l.discountPct}%` : ""}</span><span>{money(done.totals.lines[i].gross)}</span></div></div>
        ))}
        <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
        {done.totals.byRate.map((r) => <div key={r.rate} style={{ display: "flex", justifyContent: "space-between" }}><span>{t("vatAt", { rate: r.rate })} ({money(r.net)})</span><span>{money(r.vat)}</span></div>)}
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 14 }}><span>{t("total")}</span><span data-testid="till-receipt-total">{money(done.totals.gross)}</span></div>
        {done.payments.map((p, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between" }}><span>{p.method === "CASH" ? t("payCash") : p.method === "POINTS" ? t("payPointsShort") : p.method}</span><span>{money(p.method === "CASH" ? p.tendered ?? p.amount : p.amount)}</span></div>)}
        {Number(done.change) > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>{t("change")}</span><span>{money(done.change)}</span></div>}
        {done.member && <div>{t("pointsLine", { name: done.member.name, n: done.pointsEarned })}</div>}
        <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
        <div data-testid="till-receipt-legal">{done.fiscalStatus === "NOT_REQUIRED" ? t("nonFiscalNote") : done.fiscalNumber ? t("fiscalDone") : t("fiscalPending")}</div>
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL QR code, printed */}
        {qr && <img src={qr} alt="QR" width={120} height={120} style={{ margin: "6px auto 0", display: "block" }} />}
        {s.receiptFooter && <div style={{ textAlign: "center", whiteSpace: "pre-wrap" }}>{s.receiptFooter}</div>}
      </div>
      {done.offline && <p className="mt-2 text-xs text-muted-foreground" data-testid="till-receipt-offline">{t("savedOffline")}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={print} data-testid="till-print"><Printer className="size-4" /> {t("print")}</Button>
        {done.saleId && online && s.features.emailReceipt && <>
          <Input className="order-last w-full min-w-0 basis-full sm:order-none sm:basis-auto sm:flex-1" type="email" placeholder={t("receiptEmail")} value={mail} onChange={(e) => setMail(e.target.value)} data-testid="till-receipt-email" />
          <Button variant="outline" disabled={!mail} onClick={async () => { const r = done.saleId ? await emailReceiptAction({ saleId: done.saleId, email: mail }) : null; setSent(r?.ok ? t("emailSent") : r?.error ?? t("error")); }} data-testid="till-receipt-send"><Mail className="size-4" /> {t("send")}</Button>
        </>}
        <Button variant="outline" className="ml-auto" onClick={onClose} data-testid="till-new-sale">{t("newSale")}</Button>
      </div>
      {sent && <p className="mt-2 text-sm" role="status">{sent}</p>}
    </Modal>
  );
}

function ReportModal({ t, report, money, z, onClose }: { t: T; report: Record<string, unknown>; money: (n: number | string) => string; z: boolean; onClose: () => void }) {
  const r = report as { count: number; refundCount: number; gross: number; net: number; vat: number; salesGross: number; refundsGross: number; discounts: number; byPayment: Record<string, number>; byRate: { rate: number; net: number; vat: number; gross: number }[]; openingFloat: number; payIn: number; payOut: number; expectedCash: number };
  const row = (k: string, v: string, testId?: string) => <div className="flex justify-between gap-2" data-testid={testId}><span className="text-muted-foreground">{k}</span><span className="font-medium tabular-nums">{v}</span></div>;
  return (
    <Modal title={z ? t("zReport") : t("xReport")} onClose={onClose} testId="till-report">
      <div className="space-y-1 text-sm">
        {row(t("salesCount"), String(r.count), "rep-count")}
        {row(t("salesGross"), money(r.salesGross))}
        {row(t("refunds"), `${r.refundCount} · −${money(r.refundsGross)}`)}
        {row(t("discountsGiven"), money(r.discounts))}
        {row(t("netTotal"), money(r.gross), "rep-gross")}
        <div className="my-2 border-t" />
        {Object.entries(r.byPayment).map(([m, v]) => row(m === "CASH" ? t("payCash") : m === "CARD" ? t("payCard") : m === "POINTS" ? t("payPointsShort") : m, money(v), `rep-pay-${m}`))}
        <div className="my-2 border-t" />
        {r.byRate.map((x) => row(t("vatAt", { rate: x.rate }), `${money(x.net)} + ${money(x.vat)}`))}
        <div className="my-2 border-t" />
        {row(t("openingFloat"), money(r.openingFloat))}
        {row(t("cashIn"), money(r.payIn))}
        {row(t("cashOut"), money(r.payOut))}
        {row(t("expectedCash"), money(r.expectedCash), "rep-expected")}
      </div>
      <Button className="mt-3 w-full" variant="outline" onClick={() => { const el = document.querySelector("[data-testid=till-report] .space-y-1"); if (el) printHtml(`<h3>${z ? t("zReport") : t("xReport")}</h3>${el.innerHTML}`); }}><Printer className="size-4" /> {t("print")}</Button>
    </Modal>
  );
}

function CashModal({ t, shiftId, manager, askManager, onDone, onClose }: { t: T; shiftId: string; manager: boolean; askManager: (r: string, then: (u: string) => void) => void; onDone: (m: string) => void; onClose: () => void }) {
  const [kind, setKind] = useState<"PAY_IN" | "PAY_OUT" | "NO_SALE">("PAY_IN");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const go = async (approvedById: string | null) => {
    const r = await cashMoveAction({ shiftId, kind, amount: num(amount), reason: reason || null, approvedById }).catch(() => null);
    if (!r?.ok) { setErr(r?.error ?? t("needOnline")); return; }
    onDone(t("cashSaved"));
  };
  return (
    <Modal title={t("cash")} onClose={onClose} testId="till-cash-modal">
      <div className="mb-3 flex gap-1">{(["PAY_IN", "PAY_OUT", "NO_SALE"] as const).map((k) => <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} onClick={() => setKind(k)} data-testid={`till-cash-${k}`}>{t(`cash_${k}`)}</Button>)}</div>
      {kind !== "NO_SALE" && <><Label htmlFor="ca">{t("amount")}</Label><Input id="ca" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="till-cash-amount" /></>}
      <Label htmlFor="cr" className="mt-2 block">{t("reason")}</Label><Input id="cr" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="till-cash-reason" />
      {err && <p className="mt-2 text-sm text-destructive" role="alert">{err}</p>}
      <Button className="mt-3 w-full" onClick={() => (kind === "PAY_OUT" && !manager ? askManager(t("pinCashOut"), (u) => void go(u)) : void go(null))} data-testid="till-cash-save">{t("save")}</Button>
    </Modal>
  );
}

function CloseModal({ t, shiftId, money, onClosed, onClose }: { t: T; shiftId: string; money: (n: number | string) => string; onClosed: (z: Record<string, unknown>) => void; onClose: () => void }) {
  const [counted, setCounted] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={t("closeShift")} onClose={onClose} testId="till-close-modal">
      <p className="mb-2 text-sm text-muted-foreground">{t("closeText")}</p>
      <Label htmlFor="cc">{t("countedCash")}</Label>
      <Input id="cc" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} data-testid="till-counted" />
      {err && <p className="mt-2 text-sm text-destructive" role="alert">{err}</p>}
      <Button className="mt-3 w-full" disabled={busy || counted === ""} onClick={async () => { setBusy(true); const r = await closeShiftAction({ shiftId, countedCash: num(counted) }).catch(() => null); setBusy(false); if (!r?.ok) { setErr(r?.error ?? t("needOnline")); return; } const d = r.data as unknown as { report: Record<string, unknown>; shift: { difference: string } }; onClosed({ ...d.report, difference: d.shift.difference }); void money; }} data-testid="till-close-ok">{t("closeShift")}</Button>
    </Modal>
  );
}

function TablesModal({ t, tickets, onOpen, onDelete, onClose }: { t: T; tickets: TillSnapshot["tickets"]; onOpen: (tk: TillSnapshot["tickets"][number]) => void; onDelete: (id: string) => void; onClose: () => void }) {
  return (
    <Modal title={t("tables")} onClose={onClose} testId="till-tables-modal">
      {tickets.length === 0 && <p className="text-sm text-muted-foreground">{t("noTables")}</p>}
      <ul className="divide-y">{tickets.map((tk) => <li key={tk.id} className="flex items-center gap-2 py-2 text-sm"><button className="min-w-0 flex-1 text-left font-medium" onClick={() => onOpen(tk)} data-testid="till-table">{tk.label} <span className="text-xs text-muted-foreground">({(tk.lines as unknown[]).length})</span></button><Button size="icon" variant="ghost" onClick={() => onDelete(tk.id)} aria-label={t("remove")}><Trash2 className="size-4" /></Button></li>)}</ul>
    </Modal>
  );
}

function FreeModal({ t, onAdd, onClose }: { t: T; onAdd: (name: string, price: number, vat: number) => void; onClose: () => void }) {
  const [name, setName] = useState(""); const [price, setPrice] = useState(""); const [vat, setVat] = useState("23");
  return (
    <Modal title={t("freeItem")} onClose={onClose} testId="till-free-modal">
      <Label htmlFor="fn">{t("name")}</Label><Input id="fn" value={name} onChange={(e) => setName(e.target.value)} data-testid="till-free-name" />
      <div className="mt-2 grid grid-cols-2 gap-2"><div><Label htmlFor="fp">{t("priceInclVat")}</Label><Input id="fp" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="till-free-price" /></div><div><Label htmlFor="fv">{t("vatRate")}</Label><Input id="fv" inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} /></div></div>
      <Button className="mt-3 w-full" disabled={!name || num(price) <= 0} onClick={() => onAdd(name, num(price), num(vat))} data-testid="till-free-add">{t("add")}</Button>
    </Modal>
  );
}

function GuestModal({ t, members, onPick, onClose }: { t: T; members: Member[]; onPick: (m: Member) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const list = members.filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()) || m.code.includes(q) || (m.phone ?? "").replace(/\D/g, "").includes(q.replace(/\D/g, "") || "§")).slice(0, 30);
  return (
    <Modal title={t("guest")} onClose={onClose} testId="till-guest">
      <Input autoFocus placeholder={t("guestSearch")} value={q} onChange={(e) => setQ(e.target.value)} data-testid="till-guest-search" />
      <ul className="mt-2 divide-y">{list.map((m) => <li key={m.id}><button className="flex w-full justify-between gap-2 py-2 text-left text-sm" onClick={() => onPick(m)} data-testid="till-guest-row"><span>{m.name} <span className="text-xs text-muted-foreground">{m.code}</span></span><span>★ {m.points}</span></button></li>)}</ul>
      {list.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{t("guestNone")}</p>}
    </Modal>
  );
}
