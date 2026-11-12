"use client";
/** Supplier demand-planning controls (Phase 30) — 25 languages. Suggestions only; people decide. */
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRightLeft, BellOff, Check, PackagePlus, Percent, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Msg, Spin, useRun, type Opt } from "@/components/shared/run";
import {
  dismissRiskAction, dismissSuggestionAction, orderSuggestionsAction, recalculatePlanningAction, saveMyEventAction, savePlanningItemAction, savePlanningSettingsAction,
  setEventActiveAction, setUseMeasuredAction, transferForRiskAction,
} from "@/server/actions/planning";
import { acceptMarkdownAction } from "@/server/actions/inventory";
import { URGENCY_TONE } from "@/lib/planning";

const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function RecalcButton() {
  const t = useTranslations("planning");
  const { pending, error, done, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} data-testid="recalc" onClick={() => run(() => recalculatePlanningAction({}), undefined, t("recalcDone"))}><Spin on={pending} icon={RefreshCw} />{t("recalc")}</Button>
      <Msg error={error} done={done} />
    </span>
  );
}

export type SourceOpt = { key: string; label: string; kind: "OUTSIDE" | "FIRINGI"; id: string; sourceOfferId?: string | null };
export type RestockRow = {
  id: string; label: string; href: string; warehouse: string; urgency: keyof typeof URGENCY_TONE; qty: number; usable: number; incoming: number;
  reorderPoint: number; orderUpTo: number; safetyStock: number; leadTimeDays: number; dailyDemand: number; runsOutOn: string | null; orderBy: string | null;
  source: string; unitCost: string; extraSource?: SourceOpt | null;
};

export function RestockTable({ rows, sources, canOrder, locale, empty }: { rows: RestockRow[]; sources: SourceOpt[]; canOrder: boolean; locale: string; empty: string }) {
  const t = useTranslations("planning");
  const { pending, error, done, run } = useRun();
  const [made, setMade] = useState<{ id: string; number: string }[]>([]);
  // choices per suggestion id (rows can disappear after a refresh — never by position)
  type Pick = { on: boolean; qty: string; source: string; cost: string };
  const initial = (r: RestockRow): Pick => ({ on: r.urgency !== "SOON", qty: String(r.qty), source: r.source, cost: r.unitCost });
  const [edits, setEdits] = useState<Record<string, Pick>>({});
  const pickOf = (r: RestockRow) => edits[r.id] ?? initial(r);
  const set = (r: RestockRow, k: keyof Pick, v: string | boolean) => setEdits((e) => ({ ...e, [r.id]: { ...(e[r.id] ?? initial(r)), [k]: v } }));
  const chosen = rows.filter((r) => { const p = pickOf(r); return p.on && p.source; }).length;
  const fmtDay = (s: string | null) => (s ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${s}T00:00:00Z`)) : "—");
  const all = (r: RestockRow) => [...(r.extraSource && !sources.some((s) => s.key === r.extraSource!.key) ? [r.extraSource] : []), ...sources];
  const go = () => run(() => orderSuggestionsAction({
    picks: rows.flatMap((r) => {
      const p = pickOf(r);
      if (!p.on || !p.source) return [];
      const s = all(r).find((x) => x.key === p.source);
      if (!s) return [];
      return [{ id: r.id, qty: Number(p.qty), supplierId: s.kind === "OUTSIDE" ? s.id : null, sellerCompanyId: s.kind === "FIRINGI" ? s.id : null, sourceOfferId: s.kind === "FIRINGI" ? s.sourceOfferId ?? null : null, unitCost: s.kind === "OUTSIDE" ? num(p.cost) ?? 0 : null }];
    }),
  }), (d) => setMade(d as { id: string; number: string }[]), t("draftsMade", { count: chosen }));
  return (
    <div className="space-y-3" data-testid="restock-table">
      {rows.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="no-restock">{empty}</p>}
      {rows.map((r) => { const p = pickOf(r); return (
        <div key={r.id} data-testid={`restock-${r.id}`} className="glass-panel grid gap-3 rounded-xl border p-3 md:grid-cols-[auto_1fr_6rem_16rem_7rem_auto] md:items-center">
          {canOrder ? <input type="checkbox" className="size-4" aria-label={r.label} checked={p.on} onChange={(e) => set(r, "on", e.target.checked)} /> : <span />}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={URGENCY_TONE[r.urgency]} data-testid="urgency">{t(`urgency.${r.urgency}`)}</Badge>
              <Link href={r.href} className="min-w-0 truncate font-medium text-primary hover:underline">{r.label}</Link>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {r.warehouse} · {t("why", { usable: r.usable, incoming: r.incoming, rop: r.reorderPoint, upto: r.orderUpTo })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("whyMore", { daily: r.dailyDemand.toLocaleString(locale, { maximumFractionDigits: 1 }), lead: r.leadTimeDays, safety: r.safetyStock })}
              {r.runsOutOn && r.urgency !== "OUT" && <> · <span className={r.urgency === "LATE" ? "font-medium text-destructive" : ""}>{t("runsOut", { date: fmtDay(r.runsOutOn) })}</span></>}
              {r.urgency === "SOON" && r.orderBy && <> · {t("orderBy", { date: fmtDay(r.orderBy) })}</>}
            </p>
          </div>
          <div className="space-y-1"><Label className="text-xs md:sr-only">{t("qty")}</Label><Input aria-label={t("qty")} type="number" min={1} value={p.qty} onChange={(e) => set(r, "qty", e.target.value)} disabled={!canOrder} data-testid="qty" /></div>
          <div className="space-y-1"><Label className="text-xs md:sr-only">{t("source")}</Label>
            <Select aria-label={t("source")} value={p.source} onChange={(e) => set(r, "source", e.target.value)} disabled={!canOrder} data-testid="source">
              <option value="">{t("chooseSource")}</option>
              {all(r).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </div>
          {p.source.startsWith("S:") ? <div className="space-y-1"><Label className="text-xs md:sr-only">{t("unitCost")}</Label><Input aria-label={t("unitCost")} type="number" min={0} step="0.0001" value={p.cost} onChange={(e) => set(r, "cost", e.target.value)} disabled={!canOrder} /></div> : <span />}
          <DismissSuggestion id={r.id} />
        </div>
      ); })}
      {canOrder && (rows.length > 0 || made.length > 0) && (
        <div className="flex flex-wrap items-center gap-3">
          {rows.length > 0 && <Button disabled={pending || chosen === 0} onClick={go} data-testid="make-pos"><Spin on={pending} icon={PackagePlus} />{t("makePos", { count: chosen })}</Button>}
          <Msg error={error} done={done} />
          {made.length > 0 && <span className="flex flex-wrap gap-2 text-sm" data-testid="made-pos">{made.map((m) => <Link key={m.id} href={`/vendor/inventory/purchase-orders/${m.id}`} className="text-primary hover:underline">{m.number}</Link>)}</span>}
        </div>
      )}
      {rows.length > 0 && <p className="text-xs text-muted-foreground">{t("draftHint")}</p>}
    </div>
  );
}

export function DismissSuggestion({ id }: { id: string }) {
  const t = useTranslations("planning");
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("14");
  const [reason, setReason] = useState("");
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="dismiss"><BellOff className="size-4" />{t("dismiss")}</Button>;
  return (
    <div className="flex flex-wrap items-center gap-2 md:col-span-6">
      <Select aria-label={t("snooze")} className="h-8 w-40" value={days} onChange={(e) => setDays(e.target.value)} data-testid="snooze">
        {[7, 14, 30, 90].map((d) => <option key={d} value={d}>{t("snoozeDays", { days: d })}</option>)}
      </Select>
      <Input className="h-8 min-w-40 flex-1" placeholder={t("reasonOptional")} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t("reasonOptional")} />
      <Button size="sm" variant="secondary" disabled={pending} data-testid="confirm-dismiss" onClick={() => run(() => dismissSuggestionAction({ id, snoozeDays: Number(days), reason: reason || null }))}>{t("dismissConfirm")}</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
      <Msg error={error} />
    </div>
  );
}

export type ItemDraft = { serviceLevel: string; leadTimeDays: string; minOrderQty: string; packMultiple: string; source: string; unitCost: string; excluded: boolean; note: string };

export function PlanningItemForm({ offerId, addressId, initial, sources, defaults }: { offerId: string; addressId: string; initial: ItemDraft; sources: SourceOpt[]; defaults: { serviceLevel: number; leadTimeDays: number } }) {
  const t = useTranslations("planning");
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(initial);
  const s = sources.find((x) => x.key === v.source);
  return (
    <form className="space-y-4" data-testid="item-form" onSubmit={(e) => {
      e.preventDefault();
      run(() => savePlanningItemAction({
        offerId, addressId, serviceLevel: num(v.serviceLevel), leadTimeDays: num(v.leadTimeDays), minOrderQty: Number(v.minOrderQty) || 1, packMultiple: Number(v.packMultiple) || 1,
        supplierId: s?.kind === "OUTSIDE" ? s.id : null, sellerCompanyId: s?.kind === "FIRINGI" ? s.id : null, sourceOfferId: s?.kind === "FIRINGI" ? s.sourceOfferId ?? null : null,
        unitCost: num(v.unitCost), excluded: v.excluded, note: v.note || null,
      }), undefined, t("saved"));
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="pi-source">{t("source")}</Label>
          <Select id="pi-source" value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })} data-testid="pi-source">
            <option value="">{t("lastPoSource")}</option>
            {sources.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><Label htmlFor="pi-cost">{t("unitCost")}</Label><Input id="pi-cost" type="number" min={0} step="0.0001" value={v.unitCost} onChange={(e) => setV({ ...v, unitCost: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="pi-lead">{t("leadTime")}</Label><Input id="pi-lead" type="number" min={0} max={180} placeholder={t("fromSource", { days: defaults.leadTimeDays })} value={v.leadTimeDays} onChange={(e) => setV({ ...v, leadTimeDays: e.target.value })} data-testid="pi-lead" /></div>
        <div className="space-y-1"><Label htmlFor="pi-min">{t("minOrder")}</Label><Input id="pi-min" type="number" min={1} value={v.minOrderQty} onChange={(e) => setV({ ...v, minOrderQty: e.target.value })} data-testid="pi-min" /></div>
        <div className="space-y-1"><Label htmlFor="pi-mult">{t("packMultiple")}</Label><Input id="pi-mult" type="number" min={1} value={v.packMultiple} onChange={(e) => setV({ ...v, packMultiple: e.target.value })} data-testid="pi-mult" /></div>
        <div className="space-y-1"><Label htmlFor="pi-sl">{t("serviceLevel")}</Label><Input id="pi-sl" type="number" min={50} max={99} placeholder={t("companyDefault", { value: defaults.serviceLevel })} value={v.serviceLevel} onChange={(e) => setV({ ...v, serviceLevel: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="pi-note">{t("note")}</Label><Input id="pi-note" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={v.excluded} onChange={(e) => setV({ ...v, excluded: e.target.checked })} />{t("excluded")}</label>
      <div className="flex items-center gap-3"><Button type="submit" disabled={pending} data-testid="save-item"><Spin on={pending} icon={Save} />{t("save")}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function PlanningSettingsForm({ initial, defaults }: { initial: { serviceLevel: string; reviewDays: string; overstockDays: string }; defaults: { serviceLevel: number; reviewDays: number; overstockDays: number } }) {
  const t = useTranslations("planning");
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(initial);
  const field = (k: keyof typeof v, label: string, hint: string, def: number, unit: string, min: number, max: number) => (
    <div className="space-y-1.5">
      <Label htmlFor={`ps-${k}`}>{label}</Label>
      <div className="flex items-center gap-2"><Input id={`ps-${k}`} type="number" min={min} max={max} placeholder={String(def)} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} className="w-28" data-testid={`ps-${k}`} /><span className="text-sm text-muted-foreground">{unit}</span></div>
      <p className="text-xs text-muted-foreground">{hint} {t("defaultIs", { value: def })}</p>
    </div>
  );
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); run(() => savePlanningSettingsAction({ serviceLevel: num(v.serviceLevel), reviewDays: num(v.reviewDays), overstockDays: num(v.overstockDays) }), undefined, t("saved")); }}>
      <div className="grid gap-5 sm:grid-cols-3">
        {field("serviceLevel", t("serviceLevel"), t("serviceLevelHint"), defaults.serviceLevel, "%", 50, 99)}
        {field("reviewDays", t("reviewDays"), t("reviewDaysHint"), defaults.reviewDays, t("days"), 1, 60)}
        {field("overstockDays", t("overstockDays"), t("overstockDaysHint"), defaults.overstockDays, t("days"), 14, 365)}
      </div>
      <div className="flex items-center gap-3"><Button type="submit" disabled={pending} data-testid="save-settings"><Spin on={pending} icon={Save} />{t("save")}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function MeasuredToggle({ supplierId, on, canEdit }: { supplierId: string; on: boolean; canEdit: boolean }) {
  const t = useTranslations("planning");
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={on} disabled={!canEdit || pending} data-testid={`measured-${supplierId}`} onChange={(e) => run(() => setUseMeasuredAction({ supplierId, on: e.target.checked }))} />
        {t("useMeasured")}
      </label>
      <Msg error={error} />
    </span>
  );
}

export function EventForm({ offers }: { offers: Opt[] }) {
  const t = useTranslations("planning");
  const { pending, error, done, run } = useRun();
  const today = new Date().toISOString().slice(0, 10);
  const [v, setV] = useState({ name: "", startsOn: today, endsOn: today, upliftPct: "20", offerIds: [] as string[] });
  return (
    <form className="space-y-3" data-testid="event-form" onSubmit={(e) => {
      e.preventDefault();
      run(() => saveMyEventAction({ name: v.name, startsOn: v.startsOn, endsOn: v.endsOn, upliftPct: Number(v.upliftPct), offerIds: v.offerIds }), () => setV({ ...v, name: "", offerIds: [] }), t("saved"));
    }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="ev-name">{t("eventName")}</Label><Input id="ev-name" required maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={t("eventNameHint")} data-testid="ev-name" /></div>
        <div className="space-y-1"><Label htmlFor="ev-from">{t("from")}</Label><Input id="ev-from" type="date" value={v.startsOn} onChange={(e) => setV({ ...v, startsOn: e.target.value })} data-testid="ev-from" /></div>
        <div className="space-y-1"><Label htmlFor="ev-to">{t("to")}</Label><Input id="ev-to" type="date" value={v.endsOn} onChange={(e) => setV({ ...v, endsOn: e.target.value })} data-testid="ev-to" /></div>
        <div className="space-y-1"><Label htmlFor="ev-pct">{t("effect")}</Label><div className="flex items-center gap-2"><Input id="ev-pct" type="number" min={-90} max={300} value={v.upliftPct} onChange={(e) => setV({ ...v, upliftPct: e.target.value })} className="w-28" data-testid="ev-pct" /><span className="text-sm text-muted-foreground">%</span></div></div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-3"><Label htmlFor="ev-products">{t("products")}</Label>
          <Select id="ev-products" multiple className="h-28" value={v.offerIds} onChange={(e) => setV({ ...v, offerIds: [...e.target.selectedOptions].map((o) => o.value) })} data-testid="ev-products">
            {offers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Select>
          <p className="text-xs text-muted-foreground">{t("productsHint")}</p>
        </div>
      </div>
      <div className="flex items-center gap-3"><Button type="submit" disabled={pending} data-testid="save-event"><Spin on={pending} icon={Check} />{t("addEvent")}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function EventToggle({ id, active }: { id: string; active: boolean }) {
  const t = useTranslations("planning");
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setEventActiveAction({ id, active: !active }))}>{active ? t("switchOff") : t("switchOn")}</Button>
      <Msg error={error} />
    </span>
  );
}

export type RiskActionView =
  | { kind: "TRANSFER"; offerId: string; fromAddressId: string; toAddressId: string; to: string; qty: number; risk: "EXPIRY" | "OVERSTOCK" }
  | { kind: "MARKDOWN"; batchId: string; pct: number; enabled: boolean }
  | { kind: "WRITE_OFF" }
  | { kind: "STOP_BUYING" };

export function RiskActions({ riskKey, action, canManage }: { riskKey: string; action: RiskActionView; canManage: boolean }) {
  const t = useTranslations("planning");
  const { pending, error, done, run } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {action.kind === "TRANSFER" && (canManage
        ? <Button size="sm" disabled={pending || !!done} data-testid="risk-transfer" onClick={() => run(() => transferForRiskAction({ offerId: action.offerId, fromAddressId: action.fromAddressId, toAddressId: action.toAddressId, qty: action.qty, kind: action.risk }), undefined, t("transferDrafted"))}><ArrowRightLeft className="size-4" />{t("doTransfer", { qty: action.qty, to: action.to })}</Button>
        : <span className="text-sm">{t("doTransfer", { qty: action.qty, to: action.to })}</span>)}
      {action.kind === "MARKDOWN" && (action.enabled && canManage
        ? <Button size="sm" disabled={pending || !!done} data-testid="risk-markdown" onClick={() => run(() => acceptMarkdownAction({ batchId: action.batchId, percent: action.pct }), undefined, t("markdownDone"))}><Percent className="size-4" />{t("doMarkdown", { pct: action.pct })}</Button>
        : <span className="text-sm">{t("markdownOff", { pct: action.pct })} <Link href="/vendor/inventory/expiry" className="text-primary hover:underline">{t("askFiringi")}</Link></span>)}
      {action.kind === "WRITE_OFF" && <Link href="/vendor/inventory/expiry" className="text-sm text-primary hover:underline">{t("doWriteOff")}</Link>}
      {action.kind === "STOP_BUYING" && <span className="text-sm text-muted-foreground">{t("stopBuying")}</span>}
      {canManage && <Button size="sm" variant="ghost" disabled={pending} data-testid="risk-hide" onClick={() => run(() => dismissRiskAction({ key: riskKey, days: 30 }))}><BellOff className="size-4" />{t("hide30")}</Button>}
      <Msg error={error} done={done} />
    </div>
  );
}
