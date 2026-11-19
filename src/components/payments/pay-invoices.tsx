"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { payInvoicesAction } from "@/server/actions/payments";

type Inv = { id: string; number: string; dueAt: string | null; overdue: boolean; open: string; busy: boolean; currency?: string };

/** Customer: tick open invoices and pay them together. */
export function PayInvoicesForm({ invoices }: { invoices: Inv[] }) {
  const t = useTranslations("pay");
  const locale = useLocale();
  const router = useRouter();
  const payable = invoices.filter((i) => !i.busy);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(payable.filter((i) => i.overdue).map((i) => i.id).concat(payable.some((i) => i.overdue) ? [] : payable.slice(0, 1).map((i) => i.id))));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Phase 45: invoices in the customer's currency (one payment = one currency)
  const currency = invoices.find((i) => picked.has(i.id))?.currency ?? invoices[0]?.currency ?? "EUR";
  const money = (v: number | string) => new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(v));
  const total = useMemo(() => invoices.filter((i) => picked.has(i.id) && (i.currency ?? "EUR") === currency).reduce((a, i) => a + Number(i.open), 0), [invoices, picked, currency]);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="space-y-3" data-testid="pay-invoices">
      <ul className="divide-y rounded-lg border">
        {invoices.map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={picked.has(i.id)} disabled={i.busy} onChange={() => toggle(i.id)} aria-label={i.number} data-invoice={i.number} />
            <span className="min-w-0 flex-1">
              <span className="font-mono text-xs">{i.number}</span>
              {i.dueAt && <span className={`ml-2 text-xs ${i.overdue ? "text-destructive" : "text-muted-foreground"}`}>{new Date(i.dueAt).toLocaleDateString(locale)}</span>}
              {i.busy && <Badge variant="secondary" className="ml-2">{t("inProgress")}</Badge>}
            </span>
            <span className="tabular-nums">{money(i.open)}</span>
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Button disabled={pending || picked.size === 0} data-testid="pay-selected" onClick={() => start(async () => {
        setError(null);
        const r = await payInvoicesAction({ invoiceIds: [...picked] });
        if (!r.ok) return setError(r.code === "PAYMENT_IN_PROGRESS" ? t("errors.PAYMENT_IN_PROGRESS") : r.error);
        router.push(`/buy/finance/pay/${r.data.id}`);
      })}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}{t("paySelected", { amount: money(total) })}
      </Button>
    </div>
  );
}
