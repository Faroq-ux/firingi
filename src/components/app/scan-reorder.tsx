"use client";
/** Phase 39 — scan to reorder: point the camera at a product's barcode on the shelf (or use a scanner); it goes in the cart with the usual quantity. */
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, ShoppingCart, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Scanner } from "@/components/warehouse/scanner";
import { scanToCartAction } from "@/server/actions/app";
import { addToCartAction } from "@/server/actions/orders";
import type { ScanResult } from "@/server/app/scan";

type Row = { key: number; r: ScanResult | { status: "ERROR"; error: string; code: string } };

export function ScanReorder({ locale }: { locale: string }) {
  const t = useTranslations("app");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  const push = (r: Row["r"]) => setRows((x) => [{ key: Date.now() + Math.random(), r }, ...x].slice(0, 30));
  const onCode = async (code: string) => {
    setBusy(true);
    const res = await scanToCartAction({ code });
    push(res.ok ? res.data : { status: "ERROR", error: res.error ?? "", code });
    setBusy(false);
  };
  const choose = async (row: Row, o: Extract<ScanResult, { status: "CHOOSE" }>["options"][number]) => {
    const res = await addToCartAction({ offerId: o.offerId, qty: o.qty });
    setRows((x) => x.map((y) => (y.key === row.key ? { key: y.key, r: res.ok ? { status: "ADDED", offerId: o.offerId, name: o.name, packaging: o.packaging, supplier: o.supplier, qty: o.qty, total: o.qty, unitNet: o.unitNet ?? 0 } : { status: "ERROR", error: res.error ?? "", code: o.name } } : y)));
  };
  const added = rows.filter((x) => x.r.status === "ADDED").length;
  return (
    <div className="space-y-4">
      <Scanner onCode={(c) => void onCode(c)} busy={busy} testId="reorder-scan" placeholder={t("scanPlaceholder")} />
      <p className="text-sm text-muted-foreground">{t("scanHint")}</p>
      {added > 0 && <Link href="/buy/orders/cart" className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground" data-testid="scan-go-cart"><ShoppingCart className="size-4" /> {t("scanToCart", { n: added })}</Link>}
      <ul className="space-y-2" data-testid="scan-results">
        {rows.map((row) => {
          const r = row.r;
          return (
            <li key={row.key} className="rounded-xl border bg-card p-3 text-sm" data-testid="scan-result" data-status={r.status}>
              {r.status === "ADDED" && <div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-5 text-[color:var(--success,#16a34a)]" /><span className="min-w-0 flex-1"><b>{r.name}</b> · {r.packaging}<br /><span className="text-muted-foreground">{t("scanAddedLine", { qty: r.qty, price: money(r.unitNet), supplier: r.supplier, total: r.total })}</span></span></div>}
              {r.status === "NOT_FOUND" && <div className="flex items-start gap-2"><XCircle className="mt-0.5 size-5 text-destructive" /><span>{t("scanNotFound", { code: r.code })}</span></div>}
              {r.status === "ERROR" && <div className="flex items-start gap-2"><XCircle className="mt-0.5 size-5 text-destructive" /><span>{r.error}</span></div>}
              {r.status === "CHOOSE" && (
                <div className="space-y-2">
                  <p>{t("scanChoose", { code: r.code })}</p>
                  <ul className="space-y-1.5">{r.options.map((o) => (
                    <li key={o.offerId} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                      <span className="min-w-0 flex-1"><b>{o.supplier}</b> · {o.packaging}<br /><span className="text-xs text-muted-foreground">{o.unitNet != null ? money(o.unitNet) : "—"} {t("exVat")}</span></span>
                      <Button size="sm" onClick={() => void choose(row, o)} data-testid="scan-choose">{t("addQty", { qty: o.qty })}</Button>
                    </li>
                  ))}</ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
