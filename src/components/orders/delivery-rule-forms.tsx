"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { removeZoneRuleAction, setFiringiRuleAction, setVendorMinimumAction } from "@/server/actions/orders";

export type VendorRuleValues = { kind: "AMOUNT" | "UNITS"; amount: string; units: string; flatFeeNet: string };

/** Supplier's free-delivery minimum (by amount or units) and, for distributors, its flat rate below it. */
export function VendorMinimumForm({ current, distributor }: { current: VendorRuleValues | null; distributor: boolean }) {
  const t = useTranslations("orders.vendor");
  const router = useRouter();
  const [v, setV] = useState<VendorRuleValues>(current ?? { kind: "AMOUNT", amount: "", units: "", flatFeeNet: "" });
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const num = (x: string) => (x === "" ? null : Number(x));
  const save = (rule: VendorRuleValues | null) => start(async () => {
    setError(null);
    const r = await setVendorMinimumAction({ rule: rule && { kind: rule.kind, amount: rule.kind === "AMOUNT" ? num(rule.amount) : null, units: rule.kind === "UNITS" ? num(rule.units) : null, flatFeeNet: distributor ? num(rule.flatFeeNet) : null } });
    if (r.ok) router.refresh(); else setError(r.error);
  });
  const empty = v.kind === "AMOUNT" ? v.amount === "" : v.units === "";
  return (
    <div className="space-y-3" data-testid="vendor-delivery-rule">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="minKind">{t("minimumBy")}</Label>
          <select id="minKind" name="minKind" className="h-9 rounded-md border bg-card px-2 text-sm" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as "AMOUNT" | "UNITS" })}>
            <option value="AMOUNT">{t("byAmount")}</option>
            <option value="UNITS">{t("byUnits")}</option>
          </select>
        </div>
        {v.kind === "AMOUNT"
          ? <div className="space-y-1"><Label htmlFor="min">€ ({t("exclVat")})</Label><Input id="min" name="minAmount" type="number" min={0} step="0.01" className="w-40" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></div>
          : <div className="space-y-1"><Label htmlFor="minUnits">{t("units")}</Label><Input id="minUnits" name="minUnits" type="number" min={1} step="1" className="w-32" value={v.units} onChange={(e) => setV({ ...v, units: e.target.value })} /></div>}
      </div>
      {distributor && (
        <div className="space-y-1">
          <Label htmlFor="flatFee">{t("flatFee")}</Label>
          <Input id="flatFee" name="flatFee" type="number" min={0} step="0.01" className="w-40" value={v.flatFeeNet} onChange={(e) => setV({ ...v, flatFeeNet: e.target.value })} />
          <p className="text-xs text-muted-foreground">{t("flatFeeHint")}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending || empty} onClick={() => save(v)}>{t("save")}</Button>
        {current && <Button variant="ghost" disabled={pending} onClick={() => { setV({ kind: "AMOUNT", amount: "", units: "", flatFeeNet: "" }); save(null); }}>{t("remove")}</Button>}
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}

/** FIRINGI's rule for a country or a delivery zone: minimum order, flat rate, free delivery (on / off + from). */
export function FiringiRuleForm({ countryCode, zoneId, min, fee, freeEnabled, freeFrom, zones }: {
  countryCode?: string; zoneId?: string; min: string; fee: string; freeEnabled: boolean; freeFrom: string | null; zones?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [m, setM] = useState(min);
  const [f, setF] = useState(fee);
  const [on, setOn] = useState(freeEnabled);
  const [from, setFrom] = useState(freeFrom ?? "");
  const [zone, setZone] = useState(zoneId ?? zones?.[0]?.id ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const changed = !!zones || m !== min || f !== fee || on !== freeEnabled || from !== (freeFrom ?? "");
  const submit = () => start(async () => {
    setError(null); setSaved(false);
    const r = await setFiringiRuleAction({ ...(zones || zoneId ? { zoneId: zone } : { countryCode }), minOrderValue: Number(m), feeNet: Number(f), freeEnabled: on, freeFrom: from === "" ? null : Number(from) });
    if (r.ok) { setSaved(true); router.refresh(); } else setError(r.error);
  });
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid="firingi-rule-form">
      {zones && (
        <div className="space-y-1"><Label>Delivery zone</Label>
          <select name="zoneId" className="h-9 rounded-md border bg-card px-2 text-sm" value={zone} onChange={(e) => setZone(e.target.value)}>{zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}</select>
        </div>
      )}
      <div className="space-y-1"><Label>Minimum order (€, excl. VAT)</Label><Input name="minOrderValue" type="number" min={0} step="0.01" className="w-32" value={m} onChange={(e) => setM(e.target.value)} /></div>
      <div className="space-y-1"><Label>Flat rate (€, excl. VAT)</Label><Input name="feeNet" type="number" min={0} step="0.01" className="w-32" value={f} onChange={(e) => setF(e.target.value)} /></div>
      <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" name="freeEnabled" checked={on} onChange={(e) => setOn(e.target.checked)} /> FIRINGI free delivery</label>
      <div className="space-y-1"><Label>Free from (€, excl. VAT)</Label><Input name="freeFrom" type="number" min={0} step="0.01" className="w-32" disabled={!on} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
      <Button disabled={pending || !changed || (zones && !zone)} onClick={submit}>{zones ? "Add zone rule" : "Save"}</Button>
      {saved && !error && <span className="text-sm text-success" role="status">Saved</span>}
      {error && <p className="w-full text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}

export function RemoveZoneRuleButton({ zoneId }: { zoneId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => { const r = await removeZoneRuleAction({ zoneId }); if (r.ok) router.refresh(); })}>Remove</Button>;
}
