"use client";
/** Supplier inventory controls (Phase 24): forms and buttons; every text comes from the "inventory" messages. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Loader2, Minus, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import {
  acceptMarkdownAction, addFoundLineAction, cancelFeatureRequestAction, cancelPurchaseOrderAction, countStepAction, createPurchaseOrderAction, createTransferAction,
  draftFromSuggestionsAction, receivePurchaseOrderAction, receiveStockAction, receiveTransferAction, recordCountAction, requestFeatureAction, saveSupplierAction,
  sendPurchaseOrderAction, setOpeningCostAction, setReorderAction, startCountAction, transferStepAction, updatePurchaseOrderAction, writeOffAction,
} from "@/server/actions/inventory";

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
  return { pending, error, done, run };
}
function Msg({ error, done }: { error: string | null; done?: string | null }) {
  if (error) return <p className="text-sm text-destructive" role="alert">{error}</p>;
  if (done) return <p className="text-sm text-[color:var(--success,#16a34a)]" role="status">{done}</p>;
  return null;
}
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
export type Opt = { id: string; label: string };

/** Goods in without a purchase order. */
export function ReceiveForm({ offers, warehouses, offerId: fixed }: { offers: Opt[]; warehouses: Opt[]; offerId?: string }) {
  const t = useTranslations("inventory");
  const { pending, error, done, run } = useRun();
  const [f, setF] = useState({ offerId: fixed ?? "", addressId: warehouses[0]?.id ?? "", qty: "", unitCost: "", lotCode: "", expiresOn: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="receive-form"
      onSubmit={(e) => { e.preventDefault(); run(() => receiveStockAction({ offerId: f.offerId, addressId: f.addressId, qty: Number(f.qty), unitCost: num(f.unitCost), lotCode: f.lotCode || null, expiresOn: f.expiresOn || null }), () => setF({ ...f, qty: "", lotCode: "", expiresOn: "" }), t("done")); }}>
      {!fixed && (
        <div className="space-y-1 sm:col-span-2 lg:col-span-3"><Label htmlFor="rc-offer">{t("product")}</Label>
          <Select id="rc-offer" required value={f.offerId} onChange={set("offerId")}><option value="">{t("choose")}</option>{offers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></div>
      )}
      <div className="space-y-1"><Label htmlFor="rc-wh">{t("warehouse")}</Label><Select id="rc-wh" required value={f.addressId} onChange={set("addressId")}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor="rc-qty">{t("qty")}</Label><Input id="rc-qty" type="number" min={1} step={1} required value={f.qty} onChange={set("qty")} /></div>
      <div className="space-y-1"><Label htmlFor="rc-cost">{t("unitCost")} <span className="text-muted-foreground">({t("optional")})</span></Label><Input id="rc-cost" type="number" min={0} step="0.0001" value={f.unitCost} onChange={set("unitCost")} /></div>
      <div className="space-y-1"><Label htmlFor="rc-lot">{t("lot")} <span className="text-muted-foreground">({t("optional")})</span></Label><Input id="rc-lot" maxLength={60} value={f.lotCode} onChange={set("lotCode")} /></div>
      <div className="space-y-1"><Label htmlFor="rc-exp">{t("bestBefore")} <span className="text-muted-foreground">({t("optional")})</span></Label><Input id="rc-exp" type="date" value={f.expiresOn} onChange={set("expiresOn")} /></div>
      <div className="flex items-end gap-3"><Button type="submit" disabled={pending}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{t("receive")}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function WriteOffButton({ batchId, max }: { batchId: string; max: number }) {
  const t = useTranslations("inventory");
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(String(max));
  const [reason, setReason] = useState("");
  if (max <= 0) return null;
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="write-off"><Trash2 className="size-3.5" />{t("writeOff")}</Button>;
  return (
    <form className="flex flex-wrap items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); run(() => writeOffAction({ batchId, qty: Number(qty), reason }), () => setOpen(false)); }}>
      <Input aria-label={t("qty")} className="h-8 w-20" type="number" min={1} max={max} value={qty} onChange={(e) => setQty(e.target.value)} />
      <Input aria-label={t("reason")} placeholder={t("reason")} className="h-8 w-40" required maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button size="sm" variant="destructive" disabled={pending}>{t("writeOff")}</Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>{t("cancel")}</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </form>
  );
}

export function ReorderForm({ offerId, addressId, reorderPoint, reorderQty }: { offerId: string; addressId: string; reorderPoint: number | null; reorderQty: number | null }) {
  const t = useTranslations("inventory");
  const { pending, error, done, run } = useRun();
  const [rp, setRp] = useState(reorderPoint?.toString() ?? "");
  const [rq, setRq] = useState(reorderQty?.toString() ?? "");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setReorderAction({ offerId, addressId, reorderPoint: num(rp), reorderQty: num(rq) }), undefined, t("done")); }}>
      <div className="space-y-1"><Label className="text-xs">{t("reorderAt")}</Label><Input className="h-8 w-24" type="number" min={0} step={1} value={rp} onChange={(e) => setRp(e.target.value)} data-testid="reorder-point" /></div>
      <div className="space-y-1"><Label className="text-xs">{t("orderQty")}</Label><Input className="h-8 w-24" type="number" min={1} step={1} value={rq} onChange={(e) => setRq(e.target.value)} /></div>
      <Button size="sm" variant="outline" disabled={pending}>{t("save")}</Button>
      <Msg error={error} done={done} />
    </form>
  );
}

export function OpeningCostForm({ offerId, addressId }: { offerId: string; addressId: string }) {
  const t = useTranslations("inventory");
  const { pending, error, run } = useRun();
  const [v, setV] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setOpeningCostAction({ offerId, addressId, unitCost: Number(v) })); }}>
      <div className="space-y-1"><Label className="text-xs">{t("openingCost")}</Label><Input className="h-8 w-28" type="number" min={0} step="0.0001" required value={v} onChange={(e) => setV(e.target.value)} data-testid="opening-cost" /></div>
      <Button size="sm" disabled={pending}>{t("save")}</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </form>
  );
}

/** Ask FIRINGI to switch an expiry feature on / off (or withdraw the request). */
export function FeatureRequest({ feature, on, pendingId }: { feature: "FEFO" | "EXPIRY_ALERTS" | "MARKDOWN" | "SHOW_EXPIRY"; on: boolean; pendingId: string | null }) {
  const t = useTranslations("inventory");
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (pendingId) return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-[color:color-mix(in_oklch,var(--vivid-orange)_18%,transparent)] px-2 py-0.5 font-medium">{t("waiting")}</span>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelFeatureRequestAction({ id: pendingId }))}>{t("withdraw")}</Button>
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid={`ask-${feature}`}>{on ? t("askOff") : t("askOn")}</Button>;
  return (
    <form className="flex flex-wrap items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); run(() => requestFeatureAction({ feature, enable: !on, note: note || null }), () => setOpen(false)); }}>
      <Input className="h-8 w-56" placeholder={t("note")} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" disabled={pending}><Send className="size-3.5" />{t("send")}</Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>{t("cancel")}</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </form>
  );
}

export function MarkdownButton({ batchId, percent }: { batchId: string; percent: number }) {
  const t = useTranslations("inventory");
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending} onClick={() => run(() => acceptMarkdownAction({ batchId, percent }))} data-testid="accept-markdown">{t("createPromo", { percent })}</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

// ───────────────────────────── purchasing ─────────────────────────────

export type SupplierRow = { id: string; name: string; vatNumber: string | null; email: string | null; phone: string | null; address: string | null; leadTimeDays: number; notes: string | null; isActive: boolean };
export function SupplierForm({ supplier, onDone }: { supplier?: SupplierRow; onDone?: () => void }) {
  const t = useTranslations("inventory");
  const { pending, error, run } = useRun();
  const [f, setF] = useState({ name: supplier?.name ?? "", vatNumber: supplier?.vatNumber ?? "", email: supplier?.email ?? "", phone: supplier?.phone ?? "", address: supplier?.address ?? "", leadTimeDays: String(supplier?.leadTimeDays ?? 2), notes: supplier?.notes ?? "", isActive: supplier?.isActive ?? true });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <form className="grid gap-3 sm:grid-cols-2" data-testid="supplier-form"
      onSubmit={(e) => { e.preventDefault(); run(() => saveSupplierAction({ id: supplier?.id ?? null, ...f, leadTimeDays: Number(f.leadTimeDays || 0), vatNumber: f.vatNumber || null, email: f.email || null, phone: f.phone || null, address: f.address || null, notes: f.notes || null }), () => { if (!supplier) setF({ ...f, name: "", vatNumber: "", email: "", phone: "", address: "", notes: "" }); onDone?.(); }); }}>
      <div className="space-y-1"><Label htmlFor={`s-name-${supplier?.id ?? "new"}`}>{t("name")}</Label><Input id={`s-name-${supplier?.id ?? "new"}`} required maxLength={120} value={f.name} onChange={set("name")} /></div>
      <div className="space-y-1"><Label>{t("vat")}</Label><Input maxLength={30} value={f.vatNumber} onChange={set("vatNumber")} /></div>
      <div className="space-y-1"><Label>{t("email")}</Label><Input type="email" maxLength={160} value={f.email} onChange={set("email")} /></div>
      <div className="space-y-1"><Label>{t("phone")}</Label><Input maxLength={40} value={f.phone} onChange={set("phone")} /></div>
      <div className="space-y-1 sm:col-span-2"><Label>{t("address")}</Label><Input maxLength={300} value={f.address} onChange={set("address")} /></div>
      <div className="space-y-1"><Label>{t("leadTime")}</Label><Input type="number" min={0} max={365} value={f.leadTimeDays} onChange={set("leadTimeDays")} /></div>
      <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" className="size-4" checked={f.isActive} onChange={set("isActive")} />{t("active")}</label>
      <div className="flex items-center gap-3 sm:col-span-2"><Button disabled={pending}>{supplier ? t("save") : t("addSupplier")}</Button><Msg error={error} /></div>
    </form>
  );
}

export function SupplierEdit({ supplier }: { supplier: SupplierRow }) {
  const t = useTranslations("inventory");
  const [open, setOpen] = useState(false);
  return open ? <div className="glass-panel rounded-xl border p-3"><SupplierForm supplier={supplier} onDone={() => setOpen(false)} /></div> : <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{t("edit")}</Button>;
}

type Source = { id: string; name: string; offers: Opt[] };
type Line = { offerId: string; qty: string; unitCost: string; sourceOfferId: string };
export function PoForm({ suppliers, sources, offers, warehouses, initial }: {
  suppliers: Opt[]; sources: Source[]; offers: Opt[]; warehouses: Opt[];
  initial?: { id: string; supplierId: string | null; sellerCompanyId: string | null; addressId: string; expectedOn: string | null; notes: string | null; lines: { offerId: string; qty: number; unitCost: string; sourceOfferId: string | null }[] };
}) {
  const t = useTranslations("inventory");
  const router = useRouter();
  const { pending, error, run } = useRun();
  const [mode, setMode] = useState<"OUTSIDE" | "FIRINGI">(initial?.sellerCompanyId ? "FIRINGI" : "OUTSIDE");
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? suppliers[0]?.id ?? "");
  const [sellerId, setSellerId] = useState(initial?.sellerCompanyId ?? sources[0]?.id ?? "");
  const [addressId, setAddressId] = useState(initial?.addressId ?? warehouses[0]?.id ?? "");
  const [expectedOn, setExpectedOn] = useState(initial?.expectedOn ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const blank: Line = { offerId: "", qty: "1", unitCost: "", sourceOfferId: "" };
  const [lines, setLines] = useState<Line[]>(initial?.lines.map((l) => ({ offerId: l.offerId, qty: String(l.qty), unitCost: l.unitCost, sourceOfferId: l.sourceOfferId ?? "" })) ?? [blank]);
  const source = sources.find((s) => s.id === sellerId);
  const setLine = (i: number, k: keyof Line, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const submit = () => {
    const payload = {
      supplierId: mode === "OUTSIDE" ? supplierId : null, sellerCompanyId: mode === "FIRINGI" ? sellerId : null, addressId, expectedOn: expectedOn || null, notes: notes || null,
      lines: lines.map((l) => ({ offerId: l.offerId, qty: Number(l.qty), unitCost: mode === "OUTSIDE" ? num(l.unitCost) : null, sourceOfferId: mode === "FIRINGI" ? l.sourceOfferId || null : null })),
    };
    run(() => (initial ? updatePurchaseOrderAction({ ...payload, id: initial.id }) : createPurchaseOrderAction(payload)), (id) => router.push(`/vendor/inventory/purchase-orders/${id}`));
  };
  return (
    <form className="space-y-4" data-testid="po-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {sources.length > 0 && (
        <fieldset className="flex flex-wrap gap-2"><legend className="mb-1 text-sm font-medium">{t("buyFrom")}</legend>
          {(["OUTSIDE", "FIRINGI"] as const).map((m) => (
            <label key={m} className={`cursor-pointer rounded-xl border px-3 py-2 text-sm ${mode === m ? "border-primary bg-primary/10" : ""}`}>
              <input type="radio" name="mode" className="sr-only" checked={mode === m} onChange={() => setMode(m)} />{m === "OUTSIDE" ? t("mySupplier") : t("onFiringi")}
            </label>
          ))}
        </fieldset>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {mode === "OUTSIDE" ? (
          <div className="space-y-1"><Label htmlFor="po-sup">{t("supplier")}</Label>
            <Select id="po-sup" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">{t("choose")}</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
            {!suppliers.length && <p className="text-xs text-muted-foreground">{t("noSuppliers")}</p>}</div>
        ) : (
          <div className="space-y-1"><Label htmlFor="po-dist">{t("distributor")}</Label>
            <Select id="po-dist" required value={sellerId} onChange={(e) => { setSellerId(e.target.value); setLines(lines.map((l) => ({ ...l, sourceOfferId: "" }))); }}>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
        )}
        <div className="space-y-1"><Label htmlFor="po-wh">{t("receiveInto")}</Label><Select id="po-wh" required value={addressId} onChange={(e) => setAddressId(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</Select></div>
        <div className="space-y-1"><Label htmlFor="po-exp">{t("expected")}</Label><Input id="po-exp" type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} /></div>
      </div>
      {mode === "FIRINGI" && <p className="text-xs text-muted-foreground">{t("priceFromFiringi")}</p>}
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="glass-panel grid gap-2 rounded-xl border p-2 sm:grid-cols-[1fr_1fr_6rem_8rem_auto] sm:items-end" data-testid="po-line">
            <div className="space-y-1"><Label className="text-xs">{t("product")}</Label><Select required value={l.offerId} onChange={(e) => setLine(i, "offerId", e.target.value)}><option value="">{t("choose")}</option>{offers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></div>
            {mode === "FIRINGI" ? (
              <div className="space-y-1"><Label className="text-xs">{t("theirProduct")}</Label><Select required value={l.sourceOfferId} onChange={(e) => setLine(i, "sourceOfferId", e.target.value)}><option value="">{t("choose")}</option>{source?.offers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></div>
            ) : <div className="hidden sm:block" />}
            <div className="space-y-1"><Label className="text-xs">{t("qty")}</Label><Input type="number" min={1} step={1} required value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} /></div>
            {mode === "OUTSIDE" ? <div className="space-y-1"><Label className="text-xs">{t("unitCost")}</Label><Input type="number" min={0} step="0.0001" required value={l.unitCost} onChange={(e) => setLine(i, "unitCost", e.target.value)} /></div> : <div />}
            <Button type="button" size="sm" variant="ghost" aria-label={t("remove")} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Minus className="size-4" /></Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={() => setLines([...lines, blank])}><Plus className="size-4" />{t("addLine")}</Button>
      </div>
      <div className="space-y-1"><Label htmlFor="po-notes">{t("notes")}</Label><Input id="po-notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <div className="flex items-center gap-3"><Button disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}{t("saveDraft")}</Button><Msg error={error} /></div>
    </form>
  );
}

export function PoActions({ id, canSend, canCancel, viaFiringi, supplierEmail, deliveryAddresses }: { id: string; canSend: boolean; canCancel: boolean; viaFiringi: boolean; supplierEmail: string | null; deliveryAddresses: Opt[] }) {
  const t = useTranslations("inventory");
  const { pending, error, done, run } = useRun();
  const [addr, setAddr] = useState(deliveryAddresses[0]?.id ?? "");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canSend && viaFiringi && deliveryAddresses.length > 1 && <Select aria-label={t("address")} className="h-9 w-auto" value={addr} onChange={(e) => setAddr(e.target.value)}>{deliveryAddresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select>}
      {canSend && (
        <Button disabled={pending} data-testid="po-send" onClick={() => run(() => sendPurchaseOrderAction({ id, deliveryAddressId: viaFiringi ? addr || null : null }), undefined,
          viaFiringi ? undefined : supplierEmail ? t("emailed", { email: supplierEmail }) : t("done"))}><Send className="size-4" />{t("sendPo")}</Button>
      )}
      {canCancel && <Button variant="outline" disabled={pending} onClick={() => run(() => cancelPurchaseOrderAction({ id }))}>{t("cancel")}</Button>}
      <Msg error={error} done={done} />
    </div>
  );
}

export function ReceivePoForm({ poId, lines, viaFiringi }: { poId: string; viaFiringi: boolean; lines: { id: string; label: string; open: number; unitCost: string }[] }) {
  const t = useTranslations("inventory");
  const tp = useTranslations("purchased");
  const { pending, error, done, run } = useRun();
  const [rows, setRows] = useState(lines.map((l) => ({ lineId: l.id, qty: String(l.open), lotCode: "", expiresOn: "", unitCost: l.unitCost })));
  const set = (i: number, k: "qty" | "lotCode" | "expiresOn" | "unitCost", v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <form className="space-y-2" data-testid="po-receive" onSubmit={(e) => { e.preventDefault(); run(() => receivePurchaseOrderAction({ id: poId, lines: rows.map((r) => ({ lineId: r.lineId, qty: Number(r.qty || 0), lotCode: r.lotCode || null, expiresOn: r.expiresOn || null, unitCost: viaFiringi ? null : num(r.unitCost) })) }), undefined, t("done")); }}>
      {viaFiringi && <p className="text-xs text-muted-foreground" data-testid="from-distributor">{tp("fromDistributor")}</p>}
      {lines.map((l, i) => (
        <div key={l.id} className="grid gap-2 rounded-xl border p-2 sm:grid-cols-[1fr_6rem_8rem_9rem_8rem] sm:items-end">
          <div className="text-sm font-medium">{l.label}<div className="text-xs text-muted-foreground">{t("toReceive")}: {l.open}</div></div>
          <div className="space-y-1"><Label className="text-xs">{t("qty")}</Label><Input type="number" min={0} max={l.open} value={rows[i].qty} onChange={(e) => set(i, "qty", e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">{t("lot")}</Label><Input maxLength={60} value={rows[i].lotCode} onChange={(e) => set(i, "lotCode", e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">{t("bestBefore")}</Label><Input type="date" value={rows[i].expiresOn} onChange={(e) => set(i, "expiresOn", e.target.value)} /></div>
          {viaFiringi ? <div /> : <div className="space-y-1"><Label className="text-xs">{t("unitCost")}</Label><Input type="number" min={0} step="0.0001" value={rows[i].unitCost} onChange={(e) => set(i, "unitCost", e.target.value)} /></div>}
        </div>
      ))}
      <div className="flex items-center gap-3"><Button disabled={pending}><Check className="size-4" />{t("receive")}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export type ReorderRow = { offerId: string; addressId: string; label: string; warehouse: string; usable: number; incoming: number; reorderPoint: number; suggestedQty: number; supplier: { kind: "OUTSIDE" | "FIRINGI"; id: string; name: string; sourceOfferId?: string | null } | null; lastCost: string | null };
export function ReorderTable({ rows, suppliers }: { rows: ReorderRow[]; suppliers: Opt[] }) {
  const t = useTranslations("inventory");
  const { pending, error, done, run } = useRun();
  const [picks, setPicks] = useState(rows.map((r) => ({ on: true, qty: String(r.suggestedQty), supplier: r.supplier ? `${r.supplier.kind}:${r.supplier.id}` : suppliers[0] ? `OUTSIDE:${suppliers[0].id}` : "", cost: r.lastCost ?? "" })));
  const set = (i: number, k: "on" | "qty" | "supplier" | "cost", v: string | boolean) => setPicks(picks.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const go = () => run(() => draftFromSuggestionsAction({
    picks: rows.flatMap((r, i) => {
      const p = picks[i];
      if (!p.on || !p.supplier) return [];
      const [kind, sid] = p.supplier.split(":");
      return [{ offerId: r.offerId, addressId: r.addressId, qty: Number(p.qty), supplierId: kind === "OUTSIDE" ? sid : null, sellerCompanyId: kind === "FIRINGI" ? sid : null, sourceOfferId: kind === "FIRINGI" ? r.supplier?.sourceOfferId ?? null : null, unitCost: kind === "OUTSIDE" ? num(p.cost) ?? 0 : null }];
    }),
  }), undefined, t("draftsMade", { count: picks.filter((p) => p.on && p.supplier).length }));
  return (
    <div className="space-y-3" data-testid="reorder-table">
      {rows.map((r, i) => (
        <div key={`${r.offerId}-${r.addressId}`} className="glass-panel grid gap-2 rounded-xl border p-3 sm:grid-cols-[auto_1fr_6rem_12rem_7rem] sm:items-center">
          <input type="checkbox" className="size-4" aria-label={r.label} checked={picks[i].on} onChange={(e) => set(i, "on", e.target.checked)} />
          <div><div className="font-medium">{r.label}</div><div className="text-xs text-muted-foreground">{r.warehouse} · {t("free")} {r.usable} · {t("incoming")} {r.incoming} · {t("reorderAt")} {r.reorderPoint}</div></div>
          <Input aria-label={t("suggested")} type="number" min={1} value={picks[i].qty} onChange={(e) => set(i, "qty", e.target.value)} />
          <Select aria-label={t("supplier")} value={picks[i].supplier} onChange={(e) => set(i, "supplier", e.target.value)}>
            <option value="">{t("choose")}</option>
            {r.supplier?.kind === "FIRINGI" && <option value={`FIRINGI:${r.supplier.id}`}>{r.supplier.name} (FIRINGI)</option>}
            {suppliers.map((s) => <option key={s.id} value={`OUTSIDE:${s.id}`}>{s.label}</option>)}
          </Select>
          {picks[i].supplier.startsWith("OUTSIDE") ? <Input aria-label={t("unitCost")} type="number" min={0} step="0.0001" value={picks[i].cost} onChange={(e) => set(i, "cost", e.target.value)} /> : <span />}
        </div>
      ))}
      <div className="flex items-center gap-3"><Button disabled={pending || !picks.some((p) => p.on && p.supplier)} onClick={go} data-testid="make-drafts">{t("makeDrafts")}</Button><Msg error={error} done={done} /></div>
    </div>
  );
}

// ───────────────────────────── counts & transfers ─────────────────────────────

export function StartCountForm({ warehouses, offers }: { warehouses: Opt[]; offers: Opt[] }) {
  const t = useTranslations("inventory");
  const router = useRouter();
  const { pending, error, run } = useRun();
  const [addressId, setAddressId] = useState(warehouses[0]?.id ?? "");
  const [kind, setKind] = useState<"FULL" | "CYCLE">("CYCLE");
  const [picked, setPicked] = useState<string[]>([]);
  const [blind, setBlind] = useState(true);
  return (
    <form className="space-y-3" data-testid="start-count" onSubmit={(e) => { e.preventDefault(); run(() => startCountAction({ addressId, kind, offerIds: kind === "CYCLE" ? picked : undefined, blind }), (id) => router.push(`/vendor/inventory/counts/${id}`)); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label>{t("warehouse")}</Label><Select value={addressId} onChange={(e) => setAddressId(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</Select></div>
        <div className="space-y-1"><Label>{t("type")}</Label><Select value={kind} onChange={(e) => setKind(e.target.value as "FULL" | "CYCLE")}><option value="CYCLE">{t("cycle")}</option><option value="FULL">{t("full")}</option></Select></div>
      </div>
      {kind === "CYCLE" && (
        <Select multiple aria-label={t("product")} className="h-40" value={picked} onChange={(e) => setPicked([...e.target.selectedOptions].map((o) => o.value))}>
          {offers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select>
      )}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={blind} onChange={(e) => setBlind(e.target.checked)} />{t("blind")}</label>
      <div className="flex items-center gap-3"><Button disabled={pending}>{t("start")}</Button><Msg error={error} /></div>
    </form>
  );
}

export type CountLine = { id: string; label: string; lotCode: string | null; expiresOn: string | null; expectedQty: number | null; countedQty: number | null; variance: number | null; varianceValue: string | null };
export function CountSheet({ id, lines, canCount, canApprove, status, offers }: { id: string; lines: CountLine[]; canCount: boolean; canApprove: boolean; status: string; offers: Opt[] }) {
  const t = useTranslations("inventory");
  const { pending, error, done, run } = useRun();
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, l.countedQty?.toString() ?? ""])));
  const [found, setFound] = useState({ offerId: "", qty: "" });
  const save = () => recordCountAction({ id, entries: lines.map((l) => ({ lineId: l.id, countedQty: num(vals[l.id] ?? "") })) });
  const counted = lines.filter((l) => (vals[l.id] ?? "") !== "").length;
  return (
    <div className="space-y-3" data-testid="count-sheet">
      <p className="text-sm text-muted-foreground">{t("progress", { counted, total: lines.length })}</p>
      <div className="space-y-2">
        {lines.map((l) => (
          <div key={l.id} className="glass-panel grid grid-cols-[1fr_auto] items-center gap-2 rounded-xl border p-2 sm:grid-cols-[1fr_6rem_7rem_6rem]">
            <div><div className="font-medium">{l.label}</div><div className="text-xs text-muted-foreground">{l.lotCode ?? t("noLot")}{l.expiresOn ? ` · ${l.expiresOn}` : ""}</div></div>
            <div className="hidden text-right text-sm tabular-nums sm:block">{l.expectedQty ?? "—"}</div>
            {canCount ? <Input aria-label={`${t("countedQty")} ${l.label}`} className="h-9 text-right" type="number" min={0} value={vals[l.id] ?? ""} onChange={(e) => setVals({ ...vals, [l.id]: e.target.value })} data-testid="count-input" />
              : <div className="text-right font-semibold tabular-nums">{l.countedQty ?? "—"}</div>}
            <div className={`hidden text-right text-sm tabular-nums sm:block ${l.variance && l.variance < 0 ? "text-destructive" : ""}`}>{l.variance === null ? "" : l.variance > 0 ? `+${l.variance}` : l.variance}</div>
          </div>
        ))}
      </div>
      {canCount && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">{t("found")}</Label><Select className="h-9 w-64" value={found.offerId} onChange={(e) => setFound({ ...found, offerId: e.target.value })}><option value="">{t("choose")}</option>{offers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></div>
          <Input aria-label={t("countedQty")} className="h-9 w-24" type="number" min={1} value={found.qty} onChange={(e) => setFound({ ...found, qty: e.target.value })} />
          <Button size="sm" variant="outline" disabled={pending || !found.offerId || !found.qty} onClick={() => run(() => addFoundLineAction({ id, offerId: found.offerId, countedQty: Number(found.qty) }), () => setFound({ offerId: "", qty: "" }))}><Plus className="size-4" /></Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canCount && <Button variant="outline" disabled={pending} onClick={() => run(save, undefined, t("done"))}>{t("save")}</Button>}
        {canCount && <Button disabled={pending} data-testid="count-submit" onClick={() => run(async () => { const r = await save(); return r.ok ? countStepAction({ id, step: "submit" }) : r; })}>{t("submit")}</Button>}
        {status === "SUBMITTED" && <Button variant="outline" disabled={pending} onClick={() => run(() => countStepAction({ id, step: "reopen" }))}>{t("recount")}</Button>}
        {canApprove && <Button disabled={pending} data-testid="count-approve" onClick={() => run(() => countStepAction({ id, step: "approve" }))}><Check className="size-4" />{t("approve")}</Button>}
        {(status === "OPEN" || status === "SUBMITTED") && <Button variant="ghost" disabled={pending} onClick={() => run(() => countStepAction({ id, step: "cancel" }))}>{t("cancel")}</Button>}
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function TransferForm({ warehouses, offers }: { warehouses: Opt[]; offers: Opt[] }) {
  const t = useTranslations("inventory");
  const router = useRouter();
  const { pending, error, run } = useRun();
  const [from, setFrom] = useState(warehouses[0]?.id ?? "");
  const [to, setTo] = useState(warehouses[1]?.id ?? "");
  const [lines, setLines] = useState([{ offerId: "", qty: "1" }]);
  return (
    <form className="space-y-3" data-testid="transfer-form" onSubmit={(e) => { e.preventDefault(); run(() => createTransferAction({ fromAddressId: from, toAddressId: to, lines: lines.map((l) => ({ offerId: l.offerId, qty: Number(l.qty) })) }), (id) => router.push(`/vendor/inventory/transfers/${id}`)); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label>{t("fromWh")}</Label><Select value={from} onChange={(e) => setFrom(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</Select></div>
        <div className="space-y-1"><Label>{t("toWh")}</Label><Select value={to} onChange={(e) => setTo(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</Select></div>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Select aria-label={t("product")} className="min-w-0 flex-1" required value={l.offerId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, offerId: e.target.value } : x)))}><option value="">{t("choose")}</option>{offers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
          <Input aria-label={t("qty")} className="w-24" type="number" min={1} required value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
          <Button type="button" size="sm" variant="ghost" aria-label={t("remove")} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Minus className="size-4" /></Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setLines([...lines, { offerId: "", qty: "1" }])}><Plus className="size-4" />{t("addLine")}</Button>
        <Button disabled={pending}>{t("create")}</Button><Msg error={error} />
      </div>
    </form>
  );
}

export function TransferActions({ id, canSend, canReceive, canCancel, lines }: { id: string; canSend: boolean; canReceive: boolean; canCancel: boolean; lines: { id: string; label: string; qty: number }[] }) {
  const t = useTranslations("inventory");
  const { pending, error, done, run } = useRun();
  const [got, setGot] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, String(l.qty)])));
  return (
    <div className="space-y-3">
      {canReceive && (
        <div className="space-y-2" data-testid="transfer-receive">
          {lines.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 rounded-xl border p-2 text-sm"><span>{l.label}</span>
              <Input aria-label={`${t("received")} ${l.label}`} className="h-9 w-24 text-right" type="number" min={0} max={l.qty} value={got[l.id]} onChange={(e) => setGot({ ...got, [l.id]: e.target.value })} /></div>
          ))}
          <p className="text-xs text-muted-foreground">{t("lostHint")}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canSend && <Button disabled={pending} data-testid="transfer-send" onClick={() => run(() => transferStepAction({ id, step: "send" }))}><Send className="size-4" />{t("sendTransfer")}</Button>}
        {canReceive && <Button disabled={pending} data-testid="transfer-receive-btn" onClick={() => run(() => receiveTransferAction({ id, lines: lines.map((l) => ({ lineId: l.id, qty: Number(got[l.id] || 0) })) }), undefined, t("done"))}><Check className="size-4" />{t("receiveTransfer")}</Button>}
        {canCancel && <Button variant="outline" disabled={pending} onClick={() => run(() => transferStepAction({ id, step: "cancel" }))}>{t("cancel")}</Button>}
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}
