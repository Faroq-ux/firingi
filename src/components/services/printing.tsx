"use client";
/**
 * Printing (Services): the customer's order form and order actions, the print supplier's product editor and order
 * actions, FIRINGI's "mark paid", and "have them printed" on the shelf-labels page.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, FileUp, Pencil, Plus, Printer, Save, Send, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { customerPrintStepAction, markPrintPaidAction, orderPrintAction, printStepAction, savePrintProductAction } from "@/server/actions/printing";
import { PRINT_KINDS, printPrice, qtyOk, roundQty, type PrintDelivery, type PrintKind } from "@/lib/printing";
import { LABEL_FORMATS, type LabelFields } from "@/lib/shelf-labels";
import { formatMoney } from "@/lib/utils";

const box = "space-y-3 rounded-lg border bg-muted/30 p-3";
export type PrintProductRow = {
  id: string; kind: string; name: string; description: string | null; supplier?: string; labelFormat: string | null;
  unitPriceNet: number; setupNet: number; minQty: number; stepQty: number; priceOnRequest: boolean; vatRate: number; turnaroundDays: number; delivery: string[]; active: boolean;
};

/** "€0.05 each + €15 setup · from 100 · in steps of 50" or "price on request". */
export function PriceLine({ p, locale }: { p: PrintProductRow; locale: string }) {
  const t = useTranslations("printing");
  if (p.priceOnRequest) return <span>{t("onRequest")}</span>;
  return <span>{[p.unitPriceNet > 0 ? t("perItem", { price: formatMoney(p.unitPriceNet, locale) }) : null, p.setupNet > 0 ? t("setup", { price: formatMoney(p.setupNet, locale) }) : null, p.minQty > 1 ? t("minQty", { n: p.minQty }) : null, p.stepQty > 1 ? t("step", { n: p.stepQty }) : null].filter(Boolean).join(" · ")}</span>;
}

// ── customer ────────────────────────────────────────────────────────────────

export function PrintOrderForm({ p, locale }: { p: PrintProductRow; locale: string }) {
  const t = useTranslations("printing");
  const { pending, error, done, run } = useRun();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ qty: String(p.minQty), title: "", notes: "", delivery: (p.delivery[0] ?? "DELIVERY") as PrintDelivery, wantedBy: "" });
  const [files, setFiles] = useState<{ key: string; fileName: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [upErr, setUpErr] = useState<string | null>(null);
  const qty = Number(f.qty);
  const okQty = qtyOk(p, qty);
  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true); setUpErr(null);
    try {
      for (const file of Array.from(list).slice(0, 10 - files.length)) {
        const fd = new FormData(); fd.append("file", file);
        const r = await fetch("/api/services/print/upload", { method: "POST", body: fd });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { setUpErr(j.error ?? "Upload failed"); break; }
        setFiles((x) => [...x, { key: j.key, fileName: j.fileName }]);
      }
    } finally { setUploading(false); }
  };
  if (!open) return <Button size="sm" onClick={() => setOpen(true)} data-testid="pr-order-open"><Printer className="size-4" /> {t("order")}</Button>;
  return (
    <form className={box} data-testid="pr-order-form" onSubmit={(e) => { e.preventDefault(); run(() => orderPrintAction({ productId: p.id, qty, title: f.title || p.name, notes: f.notes || null, delivery: f.delivery, wantedBy: f.wantedBy ? new Date(`${f.wantedBy}T12:00:00`) : null, artwork: files }), () => { setOpen(false); setFiles([]); }, t("sent")); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label className="text-xs">{t("qty")}</Label>
          <Input type="number" min={p.minQty} step={p.stepQty} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} onBlur={() => setF({ ...f, qty: String(roundQty(p, Number(f.qty) || p.minQty)) })} data-testid="pr-qty" /></div>
        <div className="space-y-1"><Label className="text-xs">{t("orderTitle")}</Label><Input value={f.title} maxLength={120} placeholder={p.name} onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="pr-title" /></div>
        <div className="space-y-1 sm:col-span-2"><Label className="text-xs">{t("notes")}</Label><Input value={f.notes} maxLength={2000} onChange={(e) => setF({ ...f, notes: e.target.value })} data-testid="pr-notes" /></div>
        <div className="space-y-1"><Label className="text-xs">{t("deliveryLabel")}</Label>
          <Select value={f.delivery} onChange={(e) => setF({ ...f, delivery: e.target.value as PrintDelivery })} data-testid="pr-delivery">{p.delivery.map((d) => <option key={d} value={d}>{t(`delivery.${d}`)}</option>)}</Select></div>
        <div className="space-y-1"><Label className="text-xs">{t("wantedBy")}</Label><Input type="date" value={f.wantedBy} onChange={(e) => setF({ ...f, wantedBy: e.target.value })} /></div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t("files")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
            <FileUp className="size-4" /> {uploading ? t("uploading") : t("addFile")}
            <input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,image/webp" multiple disabled={uploading} onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} data-testid="pr-file" />
          </label>
          {files.map((x, k) => <span key={x.key} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs" data-testid="pr-file-chip">{x.fileName}<button type="button" aria-label={t("cancel")} onClick={() => setFiles(files.filter((_, j) => j !== k))}><X className="size-3" /></button></span>)}
        </div>
        {upErr && <p className="text-xs text-destructive">{upErr}</p>}
      </div>
      <p className="text-sm font-medium" data-testid="pr-total">{p.priceOnRequest ? t("onRequest") : okQty ? t("total", { price: formatMoney(printPrice(p, qty), locale) }) : t("qtyRule", { min: p.minQty, step: p.stepQty })}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || uploading || !okQty} data-testid="pr-send"><Spin on={pending} icon={Send} /> {t("send")}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

export function CustomerPrintActions({ id, steps }: { id: string; steps: string[] }) {
  const t = useTranslations("printing");
  const { pending, error, run } = useRun();
  if (!steps.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {steps.includes("ACCEPT_QUOTE") && <Button size="sm" disabled={pending} onClick={() => run(() => customerPrintStepAction({ id, step: "ACCEPT_QUOTE" }))} data-testid="pr-accept-quote"><Spin on={pending} icon={Check} /> {t("acceptQuote")}</Button>}
      {steps.includes("CANCEL") && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => customerPrintStepAction({ id, step: "CANCEL" }))} data-testid="pr-cancel"><X className="size-4" /> {t("cancelOrder")}</Button>}
      <Msg error={error} />
    </span>
  );
}

// ── print supplier ──────────────────────────────────────────────────────────

const EMPTY: PrintProductRow = { id: "", kind: "LEAFLET", name: "", description: "", labelFormat: "A4_21", unitPriceNet: 0, setupNet: 0, minQty: 1, stepQty: 1, priceOnRequest: false, vatRate: 23, turnaroundDays: 3, delivery: ["DELIVERY"], active: true };
export function PrintProductEditor({ initial }: { initial?: PrintProductRow }) {
  const t = useTranslations("printing");
  const tl = useTranslations("shelfLabels");
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [p, setP] = useState<PrintProductRow>(initial ?? EMPTY);
  const num = (k: keyof PrintProductRow, label: string, step = 1, testid?: string) => (
    <div className="space-y-1"><Label className="text-xs">{label}</Label><Input type="number" min={0} step={step} value={String(p[k] ?? 0)} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} data-testid={testid} /></div>
  );
  if (!open) return initial ? <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="pp-edit"><Pencil className="size-4" /> {t("edit")}</Button> : <Button size="sm" onClick={() => setOpen(true)} data-testid="pp-new"><Plus className="size-4" /> {t("addProduct")}</Button>;
  return (
    <form className={box} data-testid="pp-form" onSubmit={(e) => { e.preventDefault(); run(() => savePrintProductAction({ id: initial?.id ?? null, kind: p.kind as PrintKind, name: p.name, description: p.description || null, labelFormat: p.kind === "SHELF_LABELS" ? (p.labelFormat as (typeof LABEL_FORMATS)[number]) : null, unitPriceNet: p.unitPriceNet, setupNet: p.setupNet, minQty: p.minQty, stepQty: p.stepQty, priceOnRequest: p.priceOnRequest, vatRate: p.vatRate, turnaroundDays: p.turnaroundDays, delivery: p.delivery as PrintDelivery[], active: p.active }), () => { setOpen(false); if (!initial) setP(EMPTY); }); }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1"><Label className="text-xs">{t("kind")}</Label><Select value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value })} data-testid="pp-kind">{PRINT_KINDS.map((k) => <option key={k} value={k}>{t(`kinds.${k}`)}</option>)}</Select></div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-3"><Label className="text-xs">{t("name")}</Label><Input value={p.name} maxLength={120} onChange={(e) => setP({ ...p, name: e.target.value })} data-testid="pp-name" /></div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-4"><Label className="text-xs">{t("description")}</Label><Input value={p.description ?? ""} maxLength={1000} onChange={(e) => setP({ ...p, description: e.target.value })} /></div>
        {p.kind === "SHELF_LABELS" && <div className="space-y-1 sm:col-span-2"><Label className="text-xs">{t("labelSize")}</Label>
          <Select value={p.labelFormat ?? "A4_21"} onChange={(e) => setP({ ...p, labelFormat: e.target.value })} data-testid="pp-label-format">{LABEL_FORMATS.map((f) => <option key={f} value={f}>{tl(`formats.${f}`)}</option>)}</Select></div>}
        {!p.priceOnRequest && num("unitPriceNet", t("unitPrice"), 0.001, "pp-unit")}
        {!p.priceOnRequest && num("setupNet", t("setupPrice"), 0.01, "pp-setup")}
        {num("minQty", t("min"), 1, "pp-min")}
        {num("stepQty", t("stepQty"), 1, "pp-step")}
        {num("vatRate", t("vat"), 0.5)}
        {num("turnaroundDays", t("days"), 1)}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={p.priceOnRequest} onChange={(e) => setP({ ...p, priceOnRequest: e.target.checked })} data-testid="pp-on-request" /> {t("priceOnRequest")}</label>
        {(["DELIVERY", "PICKUP"] as const).map((d) => <label key={d} className="flex items-center gap-2"><input type="checkbox" checked={p.delivery.includes(d)} onChange={(e) => setP({ ...p, delivery: e.target.checked ? [...p.delivery, d] : p.delivery.filter((x) => x !== d) })} data-testid={`pp-delivery-${d}`} /> {t(`delivery.${d}`)}</label>)}
        <label className="flex items-center gap-2"><input type="checkbox" checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })} data-testid="pp-active" /> {t("active")}</label>
      </div>
      <div className="flex flex-wrap items-center gap-2"><Button type="submit" disabled={pending} data-testid="pp-save"><Spin on={pending} icon={Save} /> {t("save")}</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button><Msg error={error} /></div>
    </form>
  );
}

export function PrintJobActions({ id, steps, youInvoice }: { id: string; steps: string[]; youInvoice: boolean }) {
  const t = useTranslations("printing");
  const { pending, error, run } = useRun();
  const [mode, setMode] = useState<"" | "QUOTE" | "REJECT" | "DELIVERED">("");
  const [v, setV] = useState({ price: "", note: "", readyBy: "", invoiceNo: "" });
  if (!steps.length) return null;
  const go = (step: "ACCEPT" | "QUOTE" | "PRINTING" | "DELIVERED" | "REJECT") => run(() => printStepAction({ id, step, priceNet: step === "QUOTE" ? Number(v.price.replace(",", ".")) : null, note: v.note || null, readyBy: v.readyBy ? new Date(`${v.readyBy}T12:00:00`) : null, providerInvoiceNo: v.invoiceNo || null }), () => setMode(""));
  if (mode) return (
    <form className={box} data-testid="pj-form" onSubmit={(e) => { e.preventDefault(); go(mode); }}>
      <div className="grid gap-3 sm:grid-cols-3">
        {mode === "QUOTE" && <div className="space-y-1"><Label className="text-xs">{t("quotePrice")}</Label><Input inputMode="decimal" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} data-testid="pj-price" /></div>}
        {mode === "QUOTE" && <div className="space-y-1"><Label className="text-xs">{t("readyByLabel")}</Label><Input type="date" value={v.readyBy} onChange={(e) => setV({ ...v, readyBy: e.target.value })} /></div>}
        {mode !== "DELIVERED" && <div className="space-y-1 sm:col-span-3"><Label className="text-xs">{mode === "REJECT" ? t("rejectReason") : t("quoteNote")}</Label><Input value={v.note} maxLength={500} onChange={(e) => setV({ ...v, note: e.target.value })} data-testid="pj-note" /></div>}
        {mode === "DELIVERED" && youInvoice && <div className="space-y-1"><Label className="text-xs">{t("yourInvoiceNo")} *</Label><Input value={v.invoiceNo} maxLength={60} onChange={(e) => setV({ ...v, invoiceNo: e.target.value })} data-testid="pj-invoice" /></div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant={mode === "REJECT" ? "destructive" : "default"} disabled={pending} data-testid="pj-save"><Spin on={pending} icon={Check} /> {mode === "QUOTE" ? t("sendQuote") : mode === "REJECT" ? t("reject") : t("delivered")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setMode("")}>{t("cancel")}</Button>
        <Msg error={error} />
      </div>
    </form>
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {steps.includes("ACCEPT") && <Button size="sm" disabled={pending} onClick={() => go("ACCEPT")} data-testid="pj-accept"><Spin on={pending} icon={Check} /> {t("accept")}</Button>}
      {steps.includes("QUOTE") && <Button size="sm" variant="outline" onClick={() => setMode("QUOTE")} data-testid="pj-quote">{t("sendQuote")}</Button>}
      {steps.includes("PRINTING") && <Button size="sm" variant="outline" disabled={pending} onClick={() => go("PRINTING")} data-testid="pj-printing"><Printer className="size-4" /> {t("startPrinting")}</Button>}
      {steps.includes("DELIVERED") && <Button size="sm" disabled={pending} onClick={() => (youInvoice ? setMode("DELIVERED") : go("DELIVERED"))} data-testid="pj-delivered"><Truck className="size-4" /> {t("delivered")}</Button>}
      {steps.includes("REJECT") && <Button size="sm" variant="ghost" onClick={() => setMode("REJECT")} data-testid="pj-reject"><X className="size-4" /> {t("reject")}</Button>}
      <Msg error={error} />
    </span>
  );
}

// ── shelf labels: have them printed ─────────────────────────────────────────

export function OrderPrintedLabels({ products, ids, copies, fields, locale }: { products: PrintProductRow[]; ids: string[]; copies: number; fields: LabelFields; locale: string }) {
  const t = useTranslations("printing");
  const tl = useTranslations("shelfLabels");
  const { pending, error, done, run } = useRun();
  const [pid, setPid] = useState(products[0]?.id ?? "");
  const p = products.find((x) => x.id === pid);
  if (!products.length) return null;
  const qty = ids.length * copies;
  const enough = p ? qty >= p.minQty : false;
  return (
    <section className="space-y-3 rounded-lg border p-4" data-testid="sl-order-print">
      <h3 className="font-semibold">{t("labelsTitle")}</h3>
      <p className="text-xs text-muted-foreground">{t("labelsHint")}</p>
      <ul className="space-y-1">
        {products.map((x) => (
          <li key={x.id}><label className="flex cursor-pointer items-start gap-2 text-sm" data-testid="sl-print-product">
            <input type="radio" name="sl-print-product" className="mt-1" checked={pid === x.id} onChange={() => setPid(x.id)} />
            <span className="min-w-0 break-words"><span className="font-medium">{x.name}</span> <span className="text-xs text-muted-foreground">· {x.supplier} · {x.labelFormat ? tl(`formats.${x.labelFormat}`) : ""}</span>
              <span className="block text-xs text-muted-foreground"><PriceLine p={x} locale={locale} />{x.turnaroundDays ? ` · ${t("turnaround", { n: x.turnaroundDays })}` : ""}</span></span>
          </label></li>
        ))}
      </ul>
      {p && <p className="text-sm" data-testid="sl-print-total">{p.priceOnRequest ? t("onRequest") : enough ? t("labelsPrice", { price: formatMoney(printPrice(p, qty), locale) }) : t("minQty", { n: p.minQty })}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={pending || !p || !ids.length || !enough} onClick={() => run(() => orderPrintAction({ productId: pid, qty, title: tl("title"), delivery: (p!.delivery[0] ?? "DELIVERY") as PrintDelivery, labelIds: ids, copies, labelFields: fields }), undefined, t("labelsOrdered"))} data-testid="sl-print-order"><Spin on={pending} icon={Send} /> {t("labelsOrder", { n: qty })}</Button>
        <Msg error={error} done={done} />
      </div>
    </section>
  );
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export function MarkPrintPaid({ ids }: { ids: string[] }) {
  const { pending, error, done, run } = useRun();
  if (!ids.length) return null;
  return <span className="inline-flex items-center gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markPrintPaidAction({ ids }), undefined, "Recorded.")} data-testid="pa-paid"><Spin on={pending} icon={Check} /> Mark paid ({ids.length})</Button><Msg error={error} done={done} /></span>;
}
