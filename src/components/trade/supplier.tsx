"use client";
/** EU trade reporting (Phase 57) — the supplier's customs data form (texts passed in as `l`). */
import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { proposeCustomsAction } from "@/server/actions/trade";

type L = Record<string, string>;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const n = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

export function CustomsProposalForm({ l, row }: { l: L; row: { productId: string; packagingUnitId: string; cn: string | null; netKg: string | null; supp: string | null; origin: string | null; suppUnit: string | null } }) {
  const { pending, error, done, run } = useRun();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ cn: row.cn ?? "", kg: row.netKg ?? "", supp: row.supp ?? "", origin: row.origin ?? "", note: "" });
  if (!open) return <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid={`customs-edit-${row.packagingUnitId}`}>{l.edit}</Button><Msg error={null} done={done} /></div>;
  const id = (k: string) => `cu-${row.packagingUnitId}-${k}`;
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => proposeCustomsAction({ productId: row.productId, packagingUnitId: row.packagingUnitId, cnCode: v.cn || null, netWeightKg: n(v.kg), suppUnits: n(v.supp), originCountryCode: v.origin || null, note: v.note || null }), () => setOpen(false), l.sent); }} data-testid={`customs-form-${row.packagingUnitId}`}>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1"><Label htmlFor={id("cn")}>{l.cn}</Label><Input id={id("cn")} className="font-mono" value={v.cn} onChange={(e) => setV({ ...v, cn: e.target.value })} placeholder="2202 10 00" /><span className="text-xs text-muted-foreground">{l.cnHint}</span></div>
        <div className="grid gap-1"><Label htmlFor={id("kg")}>{l.netKg}</Label><Input id={id("kg")} inputMode="decimal" value={v.kg} onChange={(e) => setV({ ...v, kg: e.target.value })} /></div>
        <div className="grid gap-1"><Label htmlFor={id("supp")}>{l.supp}</Label><Input id={id("supp")} inputMode="decimal" value={v.supp} onChange={(e) => setV({ ...v, supp: e.target.value })} />{row.suppUnit && <span className="text-xs text-muted-foreground">{f(l.suppUnit, { unit: row.suppUnit })}</span>}</div>
        <div className="grid gap-1"><Label htmlFor={id("origin")}>{l.origin}</Label><Input id={id("origin")} className="uppercase" maxLength={2} value={v.origin} onChange={(e) => setV({ ...v, origin: e.target.value.toUpperCase() })} placeholder="PT" /><span className="text-xs text-muted-foreground">{l.originHint}</span></div>
      </div>
      <div className="grid gap-1"><Label htmlFor={id("note")}>{l.note}</Label><Input id={id("note")} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
      <div className="flex flex-wrap items-center gap-2"><Button size="sm" type="submit" disabled={pending} data-testid={`customs-send-${row.packagingUnitId}`}><Spin on={pending} icon={Send} /> {l.send}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}
