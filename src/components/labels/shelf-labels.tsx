"use client";
/**
 * Shelf price labels (shop): add products bought on FIRINGI (price = cost per item + margin incl. VAT) or till items,
 * edit price / promo / size / barcode, see what to print again, and print a PDF for A4 sheets, shelf strips or rolls.
 */
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Pencil, Plus, Printer, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { addLabelsFromPurchasesAction, addLabelsFromTillAction, applyLabelPricesAction, removeLabelsAction, saveLabelSizeAction, updateLabelAction } from "@/server/actions/shelf-labels";
import { CUSTOM_LIMITS, DEFAULT_FIELDS, LABEL_FORMATS, cleanCustom, customFormat, unitPrice, type CustomSize, type LabelFields, type LabelFormat } from "@/lib/shelf-labels";
import { formatDate, formatMoney } from "@/lib/utils";
import { OrderPrintedLabels, type PrintProductRow } from "@/components/services/printing";

export type SlRow = {
  id: string; name: string; barcode: string | null; brand: string | null; originCountryCode: string | null; offerId: string | null; posItemId: string | null;
  priceGross: string; marginPct: string | null; promoPrice: string | null; promoUntil: string | null; content: string | null; contentUnit: string | null;
  costNet: string | null; margin: string | null; newPrice: string | null; toPrint: boolean; printedAt: string | null;
};
export type SlPurchase = { offerId: string; name: string; pack: string; brand: string | null; barcode: string | null; costNet: string | null; times: number };
export type SlTill = { posItemId: string; name: string; barcode: string | null; priceGross: string };
export type SlAllow = { brand: boolean; origin: boolean; qr: boolean; posSync: boolean; manage: boolean; till: boolean; customSize: boolean };

const num = (v: string) => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? n : NaN; };

export function AddLabels({ purchases, till, locale, allow }: { purchases: SlPurchase[]; till: SlTill[]; locale: string; allow: SlAllow }) {
  const t = useTranslations("shelfLabels");
  const { pending, error, done, run } = useRun();
  const [tab, setTab] = useState<"P" | "T">(purchases.length || !till.length ? "P" : "T");
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [margin, setMargin] = useState("30");
  const [rounding, setRounding] = useState<"NINE" | "CENT">("NINE");
  const ql = q.trim().toLowerCase();
  const rows = tab === "P"
    ? purchases.filter((p) => !ql || p.name.toLowerCase().includes(ql) || (p.barcode ?? "").includes(ql)).map((p) => ({ id: p.offerId, name: p.name, sub: [p.brand, p.pack, p.costNet ? t("costEach", { price: formatMoney(p.costNet, locale) }) : null, t("bought", { n: p.times })].filter(Boolean).join(" · "), code: p.barcode }))
    : till.filter((p) => !ql || p.name.toLowerCase().includes(ql) || (p.barcode ?? "").includes(ql)).map((p) => ({ id: p.posItemId, name: p.name, sub: formatMoney(p.priceGross, locale), code: p.barcode }));
  const toggle = (id: string) => { const n = new Set(pick); if (n.has(id)) n.delete(id); else n.add(id); setPick(n); };
  const switchTab = (v: "P" | "T") => { setTab(v); setPick(new Set()); };
  const add = () => {
    const ids = [...pick];
    if (tab === "P") run(() => addLabelsFromPurchasesAction({ offerIds: ids, marginPct: num(margin), rounding }), () => setPick(new Set()), t("added", { n: ids.length }));
    else run(() => addLabelsFromTillAction({ posItemIds: ids }), () => setPick(new Set()), t("added", { n: ids.length }));
  };
  if (!allow.manage) return null;
  return (
    <div className="space-y-3" data-testid="sl-add">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={tab === "P" ? "default" : "outline"} onClick={() => switchTab("P")} data-testid="sl-tab-purchases">{t("tabPurchases")} ({purchases.length})</Button>
        {allow.till && <Button type="button" size="sm" variant={tab === "T" ? "default" : "outline"} onClick={() => switchTab("T")} data-testid="sl-tab-till">{t("tabTill")} ({till.length})</Button>}
        <Input className="h-9 max-w-xs" placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} data-testid="sl-add-search" />
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{tab === "P" ? t("noPurchases") : t("noTill")}</p> : (
        <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
          <li className="flex items-center gap-2 bg-muted/40 px-3 py-1.5 text-xs">
            <input type="checkbox" aria-label={t("selectAll")} checked={rows.every((r) => pick.has(r.id))} onChange={(e) => setPick(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} data-testid="sl-add-all" /> {t("selectAll")}
          </li>
          {rows.map((r) => (
            <li key={r.id}>
              <label className="flex cursor-pointer items-start gap-2 px-3 py-2 text-sm" data-testid="sl-candidate">
                <input type="checkbox" className="mt-1" checked={pick.has(r.id)} onChange={() => toggle(r.id)} />
                <span className="min-w-0 flex-1 break-words"><span className="font-medium">{r.name}</span><span className="block text-xs text-muted-foreground">{r.sub}{r.code ? ` · ${r.code}` : ""}</span></span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-3">
        {tab === "P" && <>
          <label className="space-y-1 text-sm"><span className="block text-xs text-muted-foreground">{t("margin")}</span><Input className="h-9 w-24" inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} data-testid="sl-margin" /></label>
          <label className="space-y-1 text-sm"><span className="block text-xs text-muted-foreground">{t("rounding")}</span>
            <Select className="h-9" value={rounding} onChange={(e) => setRounding(e.target.value as "NINE" | "CENT")} data-testid="sl-rounding"><option value="NINE">{t("roundNine")}</option><option value="CENT">{t("roundCent")}</option></Select></label>
        </>}
        <Button type="button" disabled={pending || !pick.size || (tab === "P" && !(num(margin) >= 0))} onClick={add} data-testid="sl-add-btn"><Spin on={pending} icon={Plus} /> {t("add", { n: pick.size })}</Button>
        <Msg error={error} done={done} />
      </div>
      {tab === "P" && <p className="text-xs text-muted-foreground">{t("marginHint")}</p>}
    </div>
  );
}

function Editor({ l, allow, onClose }: { l: SlRow; allow: SlAllow; onClose: () => void }) {
  const t = useTranslations("shelfLabels");
  const { pending, error, run } = useRun();
  const [f, setF] = useState({
    name: l.name, priceGross: l.priceGross, marginPct: l.marginPct ?? "", promoPrice: l.promoPrice ?? "", promoUntil: l.promoUntil?.slice(0, 10) ?? "",
    content: l.content ? String(Number(l.content)) : "", contentUnit: l.contentUnit ?? "", barcode: l.barcode ?? "", brand: l.brand ?? "", origin: l.originCountryCode ?? "", syncTill: false,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const save = () => {
    const priceChanged = num(f.priceGross) !== Number(l.priceGross);
    const marginChanged = (f.marginPct === "" ? null : num(f.marginPct)) !== (l.marginPct == null ? null : Number(l.marginPct));
    run(() => updateLabelAction({
      id: l.id, name: f.name, barcode: f.barcode.trim() || null, brand: f.brand || null, originCountryCode: f.origin || null,
      // a new margin re-prices from today's cost; a price typed by hand ends margin pricing
      ...(marginChanged && f.marginPct !== "" ? { marginPct: num(f.marginPct) } : priceChanged ? { priceGross: num(f.priceGross) } : marginChanged ? { marginPct: null } : {}),
      promoPrice: f.promoPrice === "" ? null : num(f.promoPrice), promoUntil: f.promoPrice === "" || !f.promoUntil ? null : new Date(`${f.promoUntil}T23:59:59`),
      content: f.content === "" ? null : num(f.content), contentUnit: f.content === "" ? null : ((f.contentUnit || "KG") as "KG" | "L"), syncTill: f.syncTill,
    }), onClose);
  };
  const field = (label: string, el: React.ReactNode) => <label className="space-y-1 text-sm"><span className="block text-xs text-muted-foreground">{label}</span>{el}</label>;
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3" data-testid="sl-editor">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">{field(t("fName"), <Input value={f.name} onChange={set("name")} maxLength={120} data-testid="sl-f-name" />)}</div>
        {field(t("fPrice"), <Input inputMode="decimal" value={f.priceGross} onChange={set("priceGross")} data-testid="sl-f-price" />)}
        {l.offerId && field(t("fMargin"), <Input inputMode="decimal" value={f.marginPct} onChange={set("marginPct")} placeholder="—" data-testid="sl-f-margin" />)}
        {field(t("fPromo"), <Input inputMode="decimal" value={f.promoPrice} onChange={set("promoPrice")} placeholder="—" data-testid="sl-f-promo" />)}
        {field(t("fPromoUntil"), <Input type="date" value={f.promoUntil} onChange={set("promoUntil")} disabled={!f.promoPrice} data-testid="sl-f-until" />)}
        {field(t("fContent"), <div className="flex gap-2"><Input inputMode="decimal" className="w-24" value={f.content} onChange={set("content")} placeholder="—" data-testid="sl-f-content" />
          <Select value={f.contentUnit} onChange={set("contentUnit")} data-testid="sl-f-unit"><option value="KG">{t("unitKg")}</option><option value="L">{t("unitL")}</option></Select></div>)}
        {field(t("fBarcode"), <Input inputMode="numeric" value={f.barcode} onChange={set("barcode")} maxLength={14} data-testid="sl-f-barcode" />)}
        {allow.brand && field(t("fBrand"), <Input value={f.brand} onChange={set("brand")} maxLength={80} />)}
        {allow.origin && field(t("fOrigin"), <Input value={f.origin} onChange={set("origin")} maxLength={2} className="w-20 uppercase" data-testid="sl-f-origin" />)}
      </div>
      {allow.posSync && allow.till && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.syncTill} onChange={set("syncTill")} data-testid="sl-f-sync" /> {t("syncTill")}</label>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={save} data-testid="sl-f-save"><Spin on={pending} icon={Check} /> {t("save")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Msg error={error} />
      </div>
    </div>
  );
}

export function LabelList({ labels, locale, allow, custom: savedSize, printProducts = [] }: { labels: SlRow[]; locale: string; allow: SlAllow; custom: CustomSize & { saved: boolean }; printProducts?: PrintProductRow[] }) {
  const t = useTranslations("shelfLabels");
  const { pending, error, done, run, router } = useRun();
  const [filter, setFilter] = useState<"ALL" | "PRINT">(labels.some((l) => l.toPrint) ? "PRINT" : "ALL");
  const [sel, setSel] = useState<Set<string>>(() => new Set(labels.filter((l) => l.toPrint).map((l) => l.id)));
  const [edit, setEdit] = useState<string | null>(null);
  const [format, setFormat] = useState<LabelFormat | "CUSTOM">(allow.customSize && savedSize.saved ? "CUSTOM" : "A4_21");
  const [custom, setCustom] = useState<CustomSize>(cleanCustom(savedSize));
  const ts = useTranslations("labelSize");
  const [fields, setFields] = useState<LabelFields>({ ...DEFAULT_FIELDS, brand: allow.brand && DEFAULT_FIELDS.brand });
  const [copies, setCopies] = useState(1);
  const [printing, setPrinting] = useState(false);
  const [printMsg, setPrintMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const shown = useMemo(() => labels.filter((l) => filter === "ALL" || l.toPrint), [labels, filter]);
  const newPrices = labels.filter((l) => l.newPrice);
  const toggle = (id: string) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };
  const box = (k: keyof LabelFields, label: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!fields[k]} onChange={(e) => setFields({ ...fields, [k]: e.target.checked })} data-testid={`sl-show-${k}`} /> {label}</label>;

  const print = async (test = false) => {
    setPrinting(true); setPrintMsg(null);
    const w = window.open("", "_blank");
    try {
      const r = await fetch("/api/buy/shelf-labels/pdf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [...sel], format, fields, copies, test, ...(format === "CUSTOM" ? { custom } : {}) }) });
      if (!r.ok) { w?.close(); setPrintMsg({ ok: false, text: (await r.text()) || t("printError") }); return; }
      const url = URL.createObjectURL(await r.blob());
      if (w) w.location.href = url; else { const a = document.createElement("a"); a.href = url; a.download = `shelf-labels-${format}.pdf`; a.click(); }
      if (test) return;
      setPrintMsg({ ok: true, text: t("printed") });
      router.refresh();
    } finally { setPrinting(false); }
  };

  if (!labels.length) return <p className="text-sm text-muted-foreground" data-testid="sl-empty">{t("emptyLabels")}</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={filter === "PRINT" ? "default" : "outline"} onClick={() => setFilter("PRINT")} data-testid="sl-filter-print">{t("filterToPrint")} ({labels.filter((l) => l.toPrint).length})</Button>
        <Button type="button" size="sm" variant={filter === "ALL" ? "default" : "outline"} onClick={() => setFilter("ALL")} data-testid="sl-filter-all">{t("filterAll")} ({labels.length})</Button>
        {allow.manage && newPrices.length > 0 && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => applyLabelPricesAction({ ids: newPrices.map((l) => l.id) }), undefined, t("saved"))} data-testid="sl-apply-new"><Spin on={pending} icon={RefreshCw} /> {t("applyNew", { n: newPrices.length })}</Button>}
        {allow.manage && sel.size > 0 && <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => removeLabelsAction({ ids: [...sel] }), () => setSel(new Set()))} data-testid="sl-remove"><Trash2 className="size-4" /> {t("remove", { n: sel.size })}</Button>}
        <Msg error={error} done={done} />
      </div>
      <ul className="divide-y rounded-lg border" data-testid="sl-list">
        <li className="flex items-center gap-2 bg-muted/40 px-3 py-1.5 text-xs">
          <input type="checkbox" aria-label={t("selectAll")} checked={shown.length > 0 && shown.every((l) => sel.has(l.id))} onChange={(e) => { const n = new Set(sel); shown.forEach((l) => (e.target.checked ? n.add(l.id) : n.delete(l.id))); setSel(n); }} data-testid="sl-select-all" /> {t("selectAll")}
        </li>
        {shown.map((l) => {
          const promoOn = l.promoPrice && (!l.promoUntil || new Date(l.promoUntil) >= new Date());
          const up = unitPrice(promoOn ? l.promoPrice! : l.priceGross, l.content, l.contentUnit);
          return (
            <li key={l.id} className="space-y-2 px-3 py-2" data-testid="sl-row">
              <div className="flex flex-wrap items-start gap-3">
                <input type="checkbox" className="mt-1" aria-label={l.name} checked={sel.has(l.id)} onChange={() => toggle(l.id)} data-testid="sl-row-check" />
                <div className="min-w-0 flex-1 basis-48 break-words">
                  <div className="font-medium">{l.name}</div>
                  <div className="text-xs text-muted-foreground">{[l.brand, l.barcode ?? t("noBarcode"), l.costNet ? t("costEach", { price: formatMoney(l.costNet, locale) }) : null, l.margin != null ? t("marginNow", { pct: l.margin }) : null].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="text-right">
                  {promoOn ? <><div className="text-xs text-muted-foreground line-through">{formatMoney(l.priceGross, locale)}</div><div className="font-semibold text-destructive" data-testid="sl-price">{formatMoney(l.promoPrice!, locale)}</div></>
                    : <div className="font-semibold" data-testid="sl-price">{formatMoney(l.priceGross, locale)}</div>}
                  {up && <div className="text-xs text-muted-foreground">{formatMoney(up.toString(), locale)}{l.contentUnit === "KG" ? t("pdf.perKg") : t("pdf.perL")}</div>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {l.toPrint ? <Badge variant="warning" data-testid="sl-status">{t("statusToPrint")}</Badge> : <Badge variant="secondary" data-testid="sl-status">{t("statusPrinted", { date: formatDate(l.printedAt, locale) })}</Badge>}
                  {l.newPrice && <span className="text-xs text-[color:var(--warning,#d97706)]" data-testid="sl-newprice">{t("newPrice", { price: formatMoney(l.newPrice, locale) })}</span>}
                  {allow.manage && <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setEdit(edit === l.id ? null : l.id)} data-testid="sl-edit"><Pencil className="size-3.5" /> {t("edit")}</Button>}
                </div>
              </div>
              {edit === l.id && <Editor l={l} allow={allow} onClose={() => setEdit(null)} />}
            </li>
          );
        })}
      </ul>

      <section className="space-y-3 rounded-lg border p-4" data-testid="sl-print">
        <h3 className="font-semibold">{t("printTitle")}</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-sm"><span className="block text-xs text-muted-foreground">{t("size")}</span>
            <Select value={format} onChange={(e) => setFormat(e.target.value as LabelFormat | "CUSTOM")} data-testid="sl-format">
              {allow.customSize && <option value="CUSTOM">{ts("mySize")}{savedSize.saved ? ` (${savedSize.w} × ${savedSize.h} mm)` : ""}</option>}
              {LABEL_FORMATS.map((f) => <option key={f} value={f}>{t(`formats.${f}`)}</option>)}
            </Select></label>
          <label className="space-y-1 text-sm"><span className="block text-xs text-muted-foreground">{t("code")}</span>
            <Select value={fields.code} onChange={(e) => setFields({ ...fields, code: e.target.value as LabelFields["code"] })} data-testid="sl-code">
              <option value="BARCODE">{t("codeBarcode")}</option>{allow.qr && <option value="QR">{t("codeQr")}</option>}<option value="NONE">{t("codeNone")}</option>
            </Select></label>
          <label className="space-y-1 text-sm"><span className="block text-xs text-muted-foreground">{t("copies")}</span>
            <Input type="number" min={1} max={50} className="w-24" value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} data-testid="sl-copies" /></label>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {box("unitPrice", t("showUnit"))}
          {allow.brand && box("brand", t("showBrand"))}
          {allow.origin && box("origin", t("showOrigin"))}
          {box("shopName", t("showShop"))}
          {box("date", t("showDate"))}
        </div>
        {format === "CUSTOM" && <SizeForm value={custom} onChange={setCustom} canSave={allow.manage} onTest={() => print(true)} testing={printing} canTest={sel.size > 0} />}
        {fields.code === "BARCODE" && allow.qr && <p className="text-xs text-muted-foreground">{t("noBarcodeHint")}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={printing || !sel.size || (format === "CUSTOM" && !customFormat(custom))} onClick={() => print()} data-testid="sl-print-btn"><Spin on={printing} icon={Printer} /> {t("print", { n: sel.size * copies })}</Button>
          {!sel.size && <span className="text-sm text-muted-foreground">{t("selectToPrint")}</span>}
          {printMsg && <p className={printMsg.ok ? "text-sm text-[color:var(--success,#16a34a)]" : "text-sm text-destructive"} role="status" data-testid="sl-print-msg">{printMsg.text}</p>}
        </div>
      </section>
      {allow.manage && <OrderPrintedLabels products={printProducts} ids={[...sel]} copies={copies} fields={fields} locale={locale} />}
    </div>
  );
}

/** The shop's own label size: paper, width × height, sticker-sheet margins and gaps, a drawing of the sheet, save, test print. */
function SizeForm({ value: c, onChange, canSave, onTest, testing, canTest }: { value: CustomSize; onChange: (c: CustomSize) => void; canSave: boolean; onTest: () => void; testing: boolean; canTest: boolean }) {
  const t = useTranslations("labelSize");
  const { pending, error, done, run } = useRun();
  const spec = customFormat(c);
  const n = (k: keyof CustomSize, label: string, lim: readonly [number, number]) => (
    <label className="space-y-1 text-sm"><span className="block text-xs text-muted-foreground">{label}</span>
      <Input type="number" inputMode="decimal" step="0.5" min={lim[0]} max={lim[1]} className="w-24" value={String(c[k])} onChange={(e) => onChange({ ...c, [k]: e.target.value === "" ? 0 : Number(e.target.value) })} onBlur={() => onChange(cleanCustom(c))} data-testid={`sz-${k}`} /></label>
  );
  // the sheet, drawn at 1 px = 2 mm
  const S = 0.5, MM = 2.834645669;
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3" data-testid="sz-form">
      <div className="text-sm font-semibold">{t("title")}</div>
      <div className="flex flex-wrap gap-4">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["A4", "ROLL"] as const).map((p) => <Button key={p} type="button" size="sm" variant={c.paper === p ? "default" : "outline"} onClick={() => onChange({ ...c, paper: p })} data-testid={`sz-paper-${p}`}>{t(p === "A4" ? "paperA4" : "paperRoll")}</Button>)}
          </div>
          <div className="flex flex-wrap gap-3">{n("w", t("width"), CUSTOM_LIMITS.w)}{n("h", t("height"), CUSTOM_LIMITS.h)}</div>
          {c.paper === "A4" && <>
            <div className="flex flex-wrap gap-3">{n("top", t("top"), CUSTOM_LIMITS.margin)}{n("left", t("left"), CUSTOM_LIMITS.margin)}{n("gapX", t("gapX"), CUSTOM_LIMITS.gap)}{n("gapY", t("gapY"), CUSTOM_LIMITS.gap)}</div>
            <p className="max-w-md text-xs text-muted-foreground">{t("marginHint")}</p>
          </>}
          <p className={spec ? "text-sm" : "text-sm text-destructive"} data-testid="sz-fits">
            {!spec ? t("noFit") : c.paper === "ROLL" ? t("perRoll") : t("fits", { n: spec.cols * spec.rows, cols: spec.cols, rows: spec.rows })}
          </p>
          {spec && c.w < 32 && <p className="max-w-md text-xs text-[color:var(--warning,#d97706)]">{t("narrowBarcode")}</p>}
        </div>
        {spec && (
          <svg width={(spec.pageW / MM) * S + 2} height={(spec.pageH / MM) * S + 2} className="shrink-0" role="img" aria-label={t("title")} data-testid="sz-preview">
            <rect x={1} y={1} width={(spec.pageW / MM) * S} height={(spec.pageH / MM) * S} fill="#fff" stroke="#9ca3af" />
            {Array.from({ length: spec.cols * spec.rows }, (_, k) => {
              const col = k % spec.cols, row = Math.floor(k / spec.cols);
              return <rect key={k} x={1 + ((spec.mx + col * (spec.w + (spec.gx ?? 0))) / MM) * S} y={1 + ((spec.my + row * (spec.h + (spec.gy ?? 0))) / MM) * S} width={(spec.w / MM) * S} height={(spec.h / MM) * S} fill="#ccfbf1" stroke="#0d9488" strokeWidth={0.6} />;
            })}
          </svg>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canSave && <Button type="button" size="sm" variant="outline" disabled={pending || !spec} onClick={() => run(() => saveLabelSizeAction(cleanCustom(c)), undefined, t("saved"))} data-testid="sz-save"><Spin on={pending} icon={Check} /> {t("save")}</Button>}
        <Button type="button" size="sm" variant="outline" disabled={testing || !spec || !canTest} onClick={onTest} data-testid="sz-test"><Printer className="size-4" /> {t("test")}</Button>
        <Msg error={error} done={done} />
      </div>
      <p className="max-w-xl text-xs text-muted-foreground">{t("testHint")}</p>
    </div>
  );
}
