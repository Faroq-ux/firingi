"use client";
/** Goods bought on FIRINGI: mark as sold / used, and (wholesalers) put a delivered order into stock. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { markUsedAction, stockDeliveredOrderAction } from "@/server/actions/inventory";

export function MarkUsed({ id, max }: { id: string; max: number }) {
  const t = useTranslations("purchased");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(String(max));
  const [error, setError] = useState<string | null>(null);
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="mark-used">{t("markUsed")}</Button>;
  return (
    <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await markUsedAction({ id, qty: Number(qty) }); if (r.ok) { setOpen(false); router.refresh(); } else setError(r.error); }); }}>
      <Input aria-label={t("qty")} className="h-8 w-20" type="number" min={1} max={max} value={qty} onChange={(e) => setQty(e.target.value)} />
      <Button size="sm" disabled={pending}><Check className="size-3.5" />{t("save")}</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </form>
  );
}

export function StockOrder({ orderId, warehouses }: { orderId: string; warehouses: { id: string; label: string }[] }) {
  const t = useTranslations("purchased");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [wh, setWh] = useState(warehouses[0]?.id ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="stock-order">
      {warehouses.length > 1 && <Select aria-label={t("warehouse")} className="h-9 w-auto" value={wh} onChange={(e) => setWh(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</Select>}
      <Button disabled={pending || !wh} onClick={() => start(async () => {
        const r = await stockDeliveredOrderAction({ orderId, addressId: wh });
        if (r.ok) { setMsg({ ok: true, text: `${t("stockDone", { lines: r.data.lines })}${r.data.missing ? ` ${t("stockMissing", { count: r.data.missing })}` : ""}` }); router.refresh(); } else setMsg({ ok: false, text: r.error });
      })}><PackagePlus className="size-4" />{t("stockButton")}</Button>
      {msg && <span className={`text-sm ${msg.ok ? "" : "text-destructive"}`} role="status">{msg.text}</span>}
    </div>
  );
}
