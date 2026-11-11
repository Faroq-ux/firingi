"use client";
/** Warehouse controls (Phase 25): shelves, put-away, pick & pack, scanner console, recalls. Texts: "warehouse" messages. */
import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, Box, Check, CheckCircle2, CircleSlash, Loader2, MapPin, PackageCheck, Plus, Printer, ScanLine, Siren, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Scanner } from "./scanner";
import {
  acknowledgeRecallAction, cancelPickListAction, closeRecallAction, confirmPickAction, createBinAction, createBinRangeAction, createPickListAction, packOrderAction,
  putAwayAction, reportRecallNoticeAction, reportShortAction, resolveScanAction, scanPickAction, startRecallAction, traceableLotsAction, updateBinAction,
} from "@/server/actions/warehouse";

type Res = { ok: boolean; error?: string; data?: unknown };
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = (fn: () => Promise<Res>, after?: (data: unknown) => void, okText?: string) =>
    start(async () => {
      setError(null); setDone(null);
      const r = await fn();
      if (r.ok) { after?.(r.data); if (okText) setDone(okText); router.refresh(); } else setError(r.error ?? "Error");
    });
  return { pending, error, done, run, setError };
}
function Msg({ error, done }: { error: string | null; done?: string | null }) {
  if (error) return <p className="text-sm text-destructive" role="alert">{error}</p>;
  if (done) return <p className="text-sm text-[color:var(--success,#16a34a)]" role="status">{done}</p>;
  return null;
}
const Spin = ({ on, icon: I }: { on: boolean; icon: React.ElementType }) => (on ? <Loader2 className="size-4 animate-spin" /> : <I className="size-4" />);
export type Opt = { id: string; label: string };

// ───────────────────────────── shelves ─────────────────────────────

export function BinRangeForm({ warehouses }: { warehouses: Opt[] }) {
  const t = useTranslations("warehouse");
  const { pending, error, done, run } = useRun();
  const [f, setF] = useState({ addressId: warehouses[0]?.id ?? "", aisles: "A, B", racks: "4", levels: "3", zone: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const total = (f.aisles.split(/[,\s]+/).filter(Boolean).length || 0) * (Number(f.racks) || 0) * (Number(f.levels) || 0);
  return (
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="bin-range-form"
      onSubmit={(e) => { e.preventDefault(); run(() => createBinRangeAction({ addressId: f.addressId, aisles: f.aisles, racks: Number(f.racks), levels: Number(f.levels), zone: f.zone || null }), undefined, t("shelvesCreated")); }}>
      <div className="space-y-1"><Label htmlFor="br-wh">{t("warehouse")}</Label><Select id="br-wh" value={f.addressId} onChange={set("addressId")}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor="br-a">{t("aisles")}</Label><Input id="br-a" required value={f.aisles} onChange={set("aisles")} placeholder="A, B, C" /></div>
      <div className="space-y-1"><Label htmlFor="br-r">{t("racks")}</Label><Input id="br-r" type="number" min={1} max={99} required value={f.racks} onChange={set("racks")} /></div>
      <div className="space-y-1"><Label htmlFor="br-l">{t("levels")}</Label><Input id="br-l" type="number" min={1} max={9} required value={f.levels} onChange={set("levels")} /></div>
      <div className="space-y-1"><Label htmlFor="br-z">{t("zone")} <span className="text-muted-foreground">({t("optional")})</span></Label><Input id="br-z" maxLength={40} value={f.zone} onChange={set("zone")} placeholder={t("zoneHint")} /></div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-5">
        <Button type="submit" disabled={pending}><Spin on={pending} icon={Plus} />{t("createShelves", { count: total })}</Button>
        <span className="text-xs text-muted-foreground">{t("rangeExample")}</span>
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

export function BinForm({ warehouses }: { warehouses: Opt[] }) {
  const t = useTranslations("warehouse");
  const { pending, error, done, run } = useRun();
  const [f, setF] = useState({ addressId: warehouses[0]?.id ?? "", code: "", zone: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="grid gap-3 sm:grid-cols-4" data-testid="bin-form" onSubmit={(e) => { e.preventDefault(); run(() => createBinAction({ addressId: f.addressId, code: f.code, zone: f.zone || null }), () => setF({ ...f, code: "" }), t("saved")); }}>
      <div className="space-y-1"><Label htmlFor="bf-wh">{t("warehouse")}</Label><Select id="bf-wh" value={f.addressId} onChange={set("addressId")}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor="bf-c">{t("shelfCode")}</Label><Input id="bf-c" required maxLength={24} value={f.code} onChange={set("code")} placeholder="FRIO-01" /></div>
      <div className="space-y-1"><Label htmlFor="bf-z">{t("zone")}</Label><Input id="bf-z" maxLength={40} value={f.zone} onChange={set("zone")} /></div>
      <div className="flex items-end gap-3"><Button type="submit" variant="outline" disabled={pending}><Spin on={pending} icon={Plus} />{t("addShelf")}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function BinToggle({ id, active }: { id: string; active: boolean }) {
  const t = useTranslations("warehouse");
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => updateBinAction({ id, isActive: !active }))}>{active ? t("retire") : t("reuse")}</Button>
      <Msg error={error} />
    </span>
  );
}

/** Put a lot (or part of it) on a shelf. */
export function PutAwayForm({ batchId, max, bins, current }: { batchId: string; max: number; bins: Opt[]; current?: string | null }) {
  const t = useTranslations("warehouse");
  const { pending, error, done, run } = useRun();
  const [binId, setBin] = useState("");
  const [qty, setQty] = useState(String(max));
  return (
    <form className="flex flex-wrap items-center gap-2" data-testid="put-away-form" onSubmit={(e) => { e.preventDefault(); run(() => putAwayAction({ batchId, binId, qty: Number(qty) || null }), undefined, t("moved")); }}>
      <Select aria-label={t("shelf")} required value={binId} onChange={(e) => setBin(e.target.value)} className="h-8 w-36"><option value="">{current ? t("moveTo") : t("putOn")}</option>{bins.filter((b) => b.id !== current).map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</Select>
      <Input aria-label={t("qty")} type="number" min={1} max={max} value={qty} onChange={(e) => setQty(e.target.value)} className="h-8 w-20" />
      <Button type="submit" size="sm" disabled={pending || !binId}><Spin on={pending} icon={MapPin} />{t("place")}</Button>
      <Msg error={error} done={done} />
    </form>
  );
}

/** Print labels for the ticked rows (shelves or lots). */
export function PrintLabels({ kind, ids, label }: { kind: "bins" | "lots"; ids: string[]; label?: string }) {
  const t = useTranslations("warehouse");
  if (!ids.length) return null;
  return (
    <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/warehouse/labels/${kind}?ids=${ids.slice(0, 400).join(",")}`} target="_blank" rel="noreferrer" data-testid={`print-${kind}`}>
      <Printer className="size-4" />{label ?? t("printLabels", { count: Math.min(ids.length, 400) })}
    </a>
  );
}

// ───────────────────────────── pick & pack ─────────────────────────────

export type Pickable = { id: string; number: string; buyer: string; city: string; units: number; lines: number; due: string | null };

export function NewPickList({ warehouses, addressId, orders }: { warehouses: Opt[]; addressId: string; orders: Pickable[] }) {
  const t = useTranslations("warehouse");
  const router = useRouter();
  const { pending, error, run } = useRun();
  const [sel, setSel] = useState<string[]>(orders.slice(0, 10).map((o) => o.id));
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <div className="space-y-3" data-testid="new-pick-list">
      {warehouses.length > 1 && (
        <nav className="flex flex-wrap gap-2 text-sm" aria-label={t("warehouse")}>
          {warehouses.map((w) => <a key={w.id} href={`?wh=${w.id}`} className={cn("rounded-full border px-3 py-1", w.id === addressId && "border-primary bg-primary/10 font-medium")}>{w.label}</a>)}
        </nav>
      )}
      {orders.length === 0 ? <p className="text-sm text-muted-foreground">{t("nothingToPick")}</p> : (
        <ul className="divide-y rounded-xl border">
          {orders.map((o) => (
            <li key={o.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-accent/40">
                <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={sel.includes(o.id)} onChange={() => toggle(o.id)} data-testid={`pick-order-${o.number}`} />
                <span className="font-mono font-medium">{o.number}</span>
                <span className="min-w-0 flex-1 truncate">{o.buyer}{o.city ? <span className="text-muted-foreground"> · {o.city}</span> : null}</span>
                <span className="whitespace-nowrap text-muted-foreground">{t("unitsN", { count: o.units })}</span>
                {o.due && <Badge variant="outline" className="hidden sm:inline-flex">{o.due}</Badge>}
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending || !sel.length} data-testid="create-pick-list" onClick={() => run(() => createPickListAction({ addressId, orderIds: sel }), (id) => router.push(`/vendor/warehouse/pick/${id as string}`))}>
          <Spin on={pending} icon={ScanLine} />{t("startPicking", { count: sel.length })}
        </Button>
        <Msg error={error} />
      </div>
    </div>
  );
}

export type PickLineView = {
  id: string; orderNumber: string; product: string; packaging: string; sku: string | null; gtin: string | null; lotCode: string | null; expiresOn: string | null;
  bin: string | null; qty: number; pickedQty: number; shortReason: string | null; verified: string | null; done: boolean; blocked: boolean;
};

const OUTCOME_TONE: Record<string, string> = { OK: "border-emerald-500/60 bg-emerald-500/10", DONE: "border-sky-500/50 bg-sky-500/10" };

/** Phone-first picking: the next line big, scan to confirm, short / by-hand when needed. */
export function PickRunner({ lines, open }: { lines: PickLineView[]; open: boolean }) {
  const t = useTranslations("warehouse");
  const { pending, error, run, setError } = useRun();
  const todo = lines.filter((l) => !l.done);
  const [focus, setFocus] = useState<string | null>(null);
  const cur = todo.find((l) => l.id === focus) ?? todo[0] ?? null;
  const [feedback, setFeedback] = useState<{ outcome: string; text: string } | null>(null);
  const [short, setShort] = useState<{ found: string; reason: string } | null>(null);
  const [qty, setQty] = useState("1");
  const done = lines.length - todo.length;

  const onCode = useCallback((code: string) => {
    if (!cur) return;
    setError(null);
    run(() => scanPickAction({ lineId: cur.id, code, qty: Math.max(1, Number(qty) || 1) }), (d) => {
      const r = d as { outcome: string; picked: number; qty: number };
      setFeedback({ outcome: r.outcome, text: t(`scan.${r.outcome}`, { picked: r.picked, qty: r.qty }) });
      if (r.outcome === "OK") setQty("1");
    });
  }, [cur, qty, run, setError, t]);

  if (!open) return null;
  return (
    <div className="space-y-4" data-testid="pick-runner">
      <div>
        <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>{t("progress")}</span><span data-testid="pick-progress">{done} / {lines.length}</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[linear-gradient(90deg,var(--vivid-violet),var(--vivid-teal,#14b8a6))] transition-all" style={{ width: `${lines.length ? (done / lines.length) * 100 : 0}%` }} /></div>
      </div>
      {cur ? (
        <div className="rounded-2xl border border-[color:var(--glass-border)] bg-[var(--glass-strong)] p-4 shadow-sm" data-testid="pick-current">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("goTo")}</p>
              <p className="font-mono text-3xl font-bold tracking-tight sm:text-4xl" data-testid="pick-bin">{cur.bin ?? t("noShelf")}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("take")}</p>
              <p className="text-3xl font-bold sm:text-4xl" data-testid="pick-take">{cur.qty - cur.pickedQty}</p>
            </div>
          </div>
          <p className="mt-3 text-lg font-semibold leading-tight">{cur.product}</p>
          <p className="text-sm text-muted-foreground">{cur.packaging}{cur.sku ? ` · ${cur.sku}` : ""} · {cur.orderNumber}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <Badge variant="outline">{t("lot")}: <span className="ml-1 font-mono" data-testid="pick-lot">{cur.lotCode ?? "—"}</span></Badge>
            {cur.expiresOn && <Badge variant="outline">{t("bestBefore")}: {cur.expiresOn}</Badge>}
            {cur.pickedQty > 0 && <Badge>{t("pickedSoFar", { picked: cur.pickedQty, qty: cur.qty })}</Badge>}
          </div>
          <div className="mt-4"><Scanner onCode={onCode} busy={pending} testId="pick-scan" placeholder={cur.lotCode ? t("scanLot") : t("scanProduct")} /></div>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <Label htmlFor="pk-qty" className="text-muted-foreground">{t("perScan")}</Label>
            <Input id="pk-qty" type="number" min={1} max={cur.qty - cur.pickedQty} value={qty} onChange={(e) => setQty(e.target.value)} className="h-8 w-20" />
          </div>
          {feedback && <p className={cn("mt-3 rounded-lg border px-3 py-2 text-sm font-medium", OUTCOME_TONE[feedback.outcome] ?? "border-destructive/50 bg-destructive/10 text-destructive")} role="status" data-testid="pick-feedback">{feedback.text}</p>}
          <Msg error={error} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => confirmPickAction({ lineId: cur.id, qty: cur.qty }), () => setFeedback(null))} data-testid="pick-manual"><Check className="size-4" />{t("confirmByHand")}</Button>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setShort(short ? null : { found: String(cur.pickedQty), reason: "" })} data-testid="pick-short"><AlertTriangle className="size-4" />{t("short")}</Button>
            {todo.length > 1 && <Button variant="ghost" size="sm" onClick={() => { const i = todo.findIndex((l) => l.id === cur.id); setFocus(todo[(i + 1) % todo.length].id); setFeedback(null); }}>{t("skip")}</Button>}
          </div>
          {short && (
            <form className="mt-3 grid gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 sm:grid-cols-3" data-testid="short-form"
              onSubmit={(e) => { e.preventDefault(); run(() => reportShortAction({ lineId: cur.id, found: Number(short.found), reason: short.reason }), (d) => { const r = d as { covered: number; still: number }; setShort(null); setFeedback({ outcome: r.still ? "SHORT" : "OK", text: r.still ? t("shortNotCovered", { count: r.still }) : t("shortCovered", { count: r.covered }) }); }); }}>
              <div className="space-y-1"><Label htmlFor="sh-f">{t("foundOnShelf")}</Label><Input id="sh-f" type="number" min={cur.pickedQty} max={cur.qty - 1} required value={short.found} onChange={(e) => setShort({ ...short, found: e.target.value })} /></div>
              <div className="space-y-1 sm:col-span-2"><Label htmlFor="sh-r">{t("reason")}</Label><Input id="sh-r" required maxLength={200} value={short.reason} onChange={(e) => setShort({ ...short, reason: e.target.value })} placeholder={t("shortHint")} /></div>
              <p className="text-xs text-muted-foreground sm:col-span-2">{t("shortExplain")}</p>
              <div className="flex items-end"><Button type="submit" size="sm" disabled={pending}><Spin on={pending} icon={AlertTriangle} />{t("reportShort")}</Button></div>
            </form>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm font-medium" data-testid="pick-all-done"><CheckCircle2 className="size-5 text-emerald-600" />{t("allPicked")}</div>
      )}
      <ol className="divide-y rounded-xl border text-sm" data-testid="pick-lines">
        {lines.map((l) => (
          <li key={l.id} className={cn("flex items-center gap-3 px-3 py-2", l.id === cur?.id && "bg-primary/5", l.done && "text-muted-foreground")}>
            <span className="w-16 shrink-0 font-mono text-xs font-semibold">{l.bin ?? "—"}</span>
            <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => !l.done && setFocus(l.id)} disabled={l.done}>{l.product} <span className="text-muted-foreground">· {l.lotCode ?? "—"} · {l.orderNumber}</span></button>
            <span className="whitespace-nowrap tabular-nums">{l.pickedQty}/{l.qty}</span>
            {l.shortReason === "RECALLED" ? <Badge variant="destructive">{t("recalledPutAside")}</Badge> : l.shortReason ? <Badge variant="outline" title={l.shortReason}>{t("shortBadge")}</Badge> : l.done ? <Check className="size-4 text-emerald-600" aria-label={l.verified === "SCAN" ? t("scanned") : t("byHand")} /> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PackOrder({ pickListId, orderId, number, canPack, packed, boxes }: { pickListId: string; orderId: string; number: string; canPack: boolean; packed: boolean; boxes: number }) {
  const t = useTranslations("warehouse");
  const { pending, error, run } = useRun();
  const [n, setN] = useState(String(Math.max(1, boxes)));
  const docs = `/api/warehouse/pick-lists/${pickListId}`;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`pack-${number}`}>
      {!packed && (
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); run(() => packOrderAction({ pickListId, orderId, boxes: Number(n) })); }}>
          <Label htmlFor={`bx-${orderId}`} className="sr-only">{t("boxes")}</Label>
          <Box className="size-4 text-muted-foreground" />
          <Input id={`bx-${orderId}`} type="number" min={1} max={999} value={n} onChange={(e) => setN(e.target.value)} className="h-8 w-16" disabled={!canPack} />
          <Button type="submit" size="sm" disabled={pending || !canPack}><Spin on={pending} icon={PackageCheck} />{t("packReady")}</Button>
        </form>
      )}
      {packed && <Badge className="gap-1"><PackageCheck className="size-3.5" />{t("packedBoxes", { count: boxes })}</Badge>}
      <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`${docs}/slip?order=${orderId}`} target="_blank" rel="noreferrer"><Printer className="size-4" />{t("packingSlip")}</a>
      {packed && <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`${docs}/boxes?order=${orderId}`} target="_blank" rel="noreferrer"><Printer className="size-4" />{t("boxLabels")}</a>}
      <Msg error={error} />
    </div>
  );
}

export function CancelPickList({ id }: { id: string }) {
  const t = useTranslations("warehouse");
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => { if (confirm(t("cancelListConfirm"))) run(() => cancelPickListAction({ id })); }}><Spin on={pending} icon={X} />{t("cancelList")}</Button>
      <Msg error={error} />
    </span>
  );
}

// ───────────────────────────── scanner console ─────────────────────────────

type Lot = { id: string; product: string; packaging: string; sku: string | null; lotCode: string | null; expiresOn: string | Date | null; daysLeft: number | null; onHand: number; reserved: number; free: number; bin: { id: string; code: string } | null; warehouse: string; addressId: string };
type ScanRes = { kind: "BATCH" | "PRODUCT"; lots: Lot[] } | { kind: "BIN"; bin: { id: string; code: string; zone: string | null; warehouse: string }; lots: Lot[] } | { kind: "ORDER"; order: { id: string; number: string; status: string }; box?: number } | { kind: "BLOCKED"; lotCode: string | null } | { kind: "UNKNOWN"; code: string };

export function ScanConsole({ binsByWarehouse, canMove }: { binsByWarehouse: Record<string, Opt[]>; canMove: boolean }) {
  const t = useTranslations("warehouse");
  const [res, setRes] = useState<{ code: string; r: ScanRes } | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const onCode = useCallback((code: string) => start(async () => {
    setError(null);
    const r = await resolveScanAction({ code });
    if (r.ok) { setRes({ code, r: r.data as ScanRes }); setHistory((h) => [code, ...h.filter((x) => x !== code)].slice(0, 6)); } else setError(r.error);
  }), []);
  const day = (d: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
  const lots = res && "lots" in res.r ? res.r.lots : [];
  return (
    <div className="space-y-4" data-testid="scan-console">
      <Scanner onCode={onCode} busy={pending} />
      {history.length > 0 && <div className="flex flex-wrap gap-1.5">{history.map((h) => <button key={h} type="button" onClick={() => onCode(h)} className="rounded-full border px-2.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-accent">{h.length > 24 ? `${h.slice(0, 22)}…` : h}</button>)}</div>}
      {pending && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("looking")}</p>}
      <Msg error={error} />
      {res && !pending && (
        <div className="space-y-3" data-testid="scan-result" data-kind={res.r.kind}>
          {res.r.kind === "UNKNOWN" && <p className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm"><CircleSlash className="size-4 text-destructive" />{t("unknownCode", { code: res.code })}</p>}
          {res.r.kind === "BLOCKED" && <p className="flex items-center gap-2 rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-sm font-semibold text-destructive"><Siren className="size-5" />{t("blockedLot", { lot: res.r.lotCode ?? "—" })}</p>}
          {res.r.kind === "ORDER" && (
            <a href={`/vendor/orders/${res.r.order.id}`} className="block rounded-xl border p-3 hover:bg-accent/40">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("order")}{res.r.box ? ` · ${t("boxN", { n: res.r.box })}` : ""}</p>
              <p className="font-mono text-xl font-bold">{res.r.order.number}</p><p className="text-sm text-muted-foreground">{res.r.order.status}</p>
            </a>
          )}
          {res.r.kind === "BIN" && <div className="rounded-xl border p-3"><p className="text-xs uppercase tracking-wider text-muted-foreground">{t("shelf")} · {res.r.bin.warehouse}{res.r.bin.zone ? ` · ${res.r.bin.zone}` : ""}</p><p className="font-mono text-2xl font-bold">{res.r.bin.code}</p>{!lots.length && <p className="text-sm text-muted-foreground">{t("shelfEmpty")}</p>}</div>}
          {lots.map((l) => (
            <div key={l.id} className="rounded-xl border p-3" data-testid="scan-lot">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="font-semibold leading-tight">{l.product}</p><p className="text-sm text-muted-foreground">{l.packaging}{l.sku ? ` · ${l.sku}` : ""} · {l.warehouse}</p></div>
                <div className="text-right"><p className="text-2xl font-bold tabular-nums">{l.onHand}</p><p className="text-xs text-muted-foreground">{t("freeN", { count: l.free })}</p></div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                <Badge variant="outline">{t("lot")}: <span className="ml-1 font-mono">{l.lotCode ?? "—"}</span></Badge>
                <Badge variant={l.daysLeft !== null && l.daysLeft < 0 ? "destructive" : "outline"}>{t("bestBefore")}: {day(l.expiresOn)}</Badge>
                <Badge variant="outline"><MapPin className="mr-1 size-3" />{l.bin?.code ?? t("noShelf")}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {canMove && <PutAwayForm batchId={l.id} max={l.onHand} bins={binsByWarehouse[l.addressId] ?? []} current={l.bin?.id ?? null} />}
                <PrintLabels kind="lots" ids={[l.id]} label={t("printLotLabel")} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── traceability & recalls ─────────────────────────────

export function TracePicker({ offers, offerId, lotCode, base }: { offers: Opt[]; offerId?: string; lotCode?: string; base: string }) {
  const t = useTranslations("warehouse");
  const router = useRouter();
  const [offer, setOffer] = useState(offerId ?? "");
  const [lots, setLots] = useState<{ lotCode: string; expiresOn: string | null; onHand: number }[] | null>(null);
  const [lot, setLot] = useState(lotCode ?? "");
  const [pending, start] = useTransition();
  const load = (id: string) => start(async () => { setOffer(id); setLots(null); if (!id) return; const r = await traceableLotsAction({ offerId: id }); if (r.ok) setLots((r.data as { lotCode: string; expiresOn: string | null; onHand: number }[]).map((x) => ({ ...x, expiresOn: x.expiresOn ? String(x.expiresOn).slice(0, 10) : null }))); });
  return (
    <form className="grid gap-3 sm:grid-cols-[2fr_1fr_auto]" data-testid="trace-picker" onSubmit={(e) => { e.preventDefault(); if (offer && lot) router.push(`${base}?offer=${offer}&lot=${encodeURIComponent(lot)}`); }}>
      <div className="space-y-1"><Label htmlFor="tr-o">{t("product")}</Label><Select id="tr-o" value={offer} onChange={(e) => load(e.target.value)} required><option value="">{t("choose")}</option>{offers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor="tr-l">{t("lot")}</Label>
        {lots && lots.length ? (
          <Select id="tr-l" value={lot} onChange={(e) => setLot(e.target.value)} required><option value="">{t("choose")}</option>{lots.map((l) => <option key={`${l.lotCode}|${l.expiresOn}`} value={l.lotCode}>{l.lotCode}{l.expiresOn ? ` · ${l.expiresOn}` : ""}</option>)}</Select>
        ) : <Input id="tr-l" value={lot} onChange={(e) => setLot(e.target.value)} required placeholder={pending ? "…" : t("lotNumber")} />}
      </div>
      <div className="flex items-end"><Button type="submit" disabled={!offer || !lot}><ScanLine className="size-4" />{t("trace")}</Button></div>
    </form>
  );
}

export function RecallForm({ offerId, lotCode, base, units }: { offerId: string; lotCode: string; base: string; units?: number }) {
  const t = useTranslations("warehouse");
  const router = useRouter();
  const { pending, error, run } = useRun();
  const [f, setF] = useState({ recallClass: "CLASS_II", reason: "", instructions: "" });
  const [sure, setSure] = useState(false);
  const classes = useMemo(() => ["CLASS_I", "CLASS_II", "CLASS_III"], []);
  return (
    <form className="space-y-3" data-testid="recall-form" onSubmit={(e) => { e.preventDefault(); run(() => startRecallAction({ offerId, lotCode, recallClass: f.recallClass as "CLASS_I", reason: f.reason, instructions: f.instructions || null }), (d) => router.push(`${base}/${(d as { id: string }).id}`)); }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label htmlFor="rc-c">{t("recallClass")}</Label><Select id="rc-c" value={f.recallClass} onChange={(e) => setF({ ...f, recallClass: e.target.value })}>{classes.map((c) => <option key={c} value={c}>{t(`class.${c}`)}</option>)}</Select></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="rc-r">{t("reason")}</Label><Input id="rc-r" required minLength={5} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={t("reasonHint")} /></div>
      </div>
      <div className="space-y-1"><Label htmlFor="rc-i">{t("instructions")}</Label><textarea id="rc-i" maxLength={1000} rows={3} className="w-full rounded-lg border border-input bg-card/80 px-3 py-2 text-sm" value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} placeholder={t("instructionsHint")} /></div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="recall-confirm" />{t("recallConfirm", { lot: lotCode, units: units ?? 0 })}</label>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" variant="destructive" disabled={pending || !sure}><Spin on={pending} icon={Siren} />{t("startRecall")}</Button><Msg error={error} /></div>
    </form>
  );
}

export function CloseRecall({ id }: { id: string }) {
  const t = useTranslations("warehouse");
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <form className="flex flex-wrap items-center gap-2" data-testid="close-recall" onSubmit={(e) => { e.preventDefault(); run(() => closeRecallAction({ id, note: note || null })); }}>
      <Input aria-label={t("closeNote")} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("closeNote")} maxLength={500} className="h-9 w-full sm:w-72" />
      <Button type="submit" variant="outline" size="sm" disabled={pending}><Spin on={pending} icon={Check} />{t("closeRecall")}</Button>
      <Msg error={error} />
    </form>
  );
}

export function RecallNoticeActions({ id, status, qty, returnedQty, destroyedQty, noneLeft, note, open }: { id: string; status: string; qty: number; returnedQty: number; destroyedQty: number; noneLeft: boolean; note: string | null; open: boolean }) {
  const t = useTranslations("warehouse");
  const { pending, error, done, run } = useRun();
  const [f, setF] = useState({ returnedQty: String(returnedQty), destroyedQty: String(destroyedQty), noneLeft, note: note ?? "" });
  if (!open) return null;
  return (
    <div className="space-y-4">
      {status === "NOTIFIED" && <Button onClick={() => run(() => acknowledgeRecallAction({ id }))} disabled={pending} data-testid="recall-ack"><Spin on={pending} icon={Check} />{t("acknowledge")}</Button>}
      <form className="grid gap-3 sm:grid-cols-3" data-testid="recall-report" onSubmit={(e) => { e.preventDefault(); run(() => reportRecallNoticeAction({ id, returnedQty: Number(f.returnedQty) || 0, destroyedQty: Number(f.destroyedQty) || 0, noneLeft: f.noneLeft, note: f.note || null }), undefined, t("thanksReported")); }}>
        <div className="space-y-1"><Label htmlFor="rn-r">{t("returnedQty")}</Label><Input id="rn-r" type="number" min={0} max={qty} value={f.returnedQty} onChange={(e) => setF({ ...f, returnedQty: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="rn-d">{t("destroyedQty")}</Label><Input id="rn-d" type="number" min={0} max={qty} value={f.destroyedQty} onChange={(e) => setF({ ...f, destroyedQty: e.target.value })} /></div>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" className="size-4" checked={f.noneLeft} onChange={(e) => setF({ ...f, noneLeft: e.target.checked })} />{t("noneLeft")}</label>
        <div className="space-y-1 sm:col-span-3"><Label htmlFor="rn-n">{t("note")}</Label><Input id="rn-n" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3"><Button type="submit" variant="outline" disabled={pending}><Spin on={pending} icon={Check} />{t("sendReport")}</Button><Msg error={error} done={done} /></div>
      </form>
    </div>
  );
}
