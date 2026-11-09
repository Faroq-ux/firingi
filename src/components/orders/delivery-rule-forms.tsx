"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { setFiringiRuleAction, setVendorMinimumAction } from "@/server/actions/orders";

export function VendorMinimumForm({ current }: { current: string | null }) {
  const t = useTranslations("orders.vendor");
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = (amount: number | null) => start(async () => { const r = await setVendorMinimumAction({ amount }); if (r.ok) router.refresh(); else setError(r.error); });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1"><Label htmlFor="min">€ (excl. VAT)</Label><Input id="min" type="number" min={0} step="0.01" className="w-40" value={value} onChange={(e) => setValue(e.target.value)} /></div>
      <Button disabled={pending || value === ""} onClick={() => save(Number(value))}>{t("save")}</Button>
      {current && <Button variant="ghost" disabled={pending} onClick={() => { setValue(""); save(null); }}>{t("remove")}</Button>}
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function FiringiRuleForm({ countryCode, min, fee }: { countryCode: string; min: string; fee: string }) {
  const router = useRouter();
  const [m, setM] = useState(min);
  const [f, setF] = useState(fee);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1"><Label>FIRINGI minimum (€, excl. VAT)</Label><Input type="number" min={0} step="0.01" className="w-36" value={m} onChange={(e) => setM(e.target.value)} /></div>
      <div className="space-y-1"><Label>Delivery fee (€, excl. VAT)</Label><Input type="number" min={0} step="0.01" className="w-36" value={f} onChange={(e) => setF(e.target.value)} /></div>
      <Button disabled={pending || (m === min && f === fee)} onClick={() => start(async () => { const r = await setFiringiRuleAction({ countryCode, minOrderValue: Number(m), feeNet: Number(f) }); if (r.ok) router.refresh(); else setError(r.error); })}>Save</Button>
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </div>
  );
}
