"use client";
/** Supplier side of plans & early payout (Phase 36): choose a plan, ask to be paid early. */
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Banknote, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { cancelEarlyPayAction, choosePlanAction, requestEarlyPayAction } from "@/server/actions/plans";
import { earlyFee, type EarlyPayModel } from "@/lib/plans";

export function ChoosePlanButton({ planId, label, variant = "default" }: { planId: string; label: string; variant?: "default" | "outline" }) {
  const t = useTranslations("plans");
  const { pending, error, done, run } = useRun();
  return (
    <span className="flex flex-col items-stretch gap-1">
      <Button variant={variant} disabled={pending} data-testid={`choose-${planId}`}
        onClick={() => run(() => choosePlanAction({ planId }), undefined, t("chosen"))}><Spin on={pending} icon={Check} /> {label}</Button>
      <Msg error={error} done={done} />
    </span>
  );
}

type Inv = { id: string; number: string; dueDate: string; days: number; amount: number; fee: number; eligible: boolean };

export function EarlyPayForm({ invoices, model, rate, minFee, freeLeft, room, vatRate, locale }: { invoices: Inv[]; model: EarlyPayModel; rate: number; minFee: number; freeLeft: number; room: number; vatRate: number; locale: string }) {
  const t = useTranslations("plans");
  const { pending, error, done, run } = useRun();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  const date = (s: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(s));
  const q = useMemo(() => {
    const pick = invoices.filter((i) => sel.has(i.id));
    const amount = Math.round(pick.reduce((a, i) => a + i.amount, 0) * 100) / 100;
    const free = freeLeft > 0;
    let fee = free ? 0 : Math.round(pick.reduce((a, i) => a + earlyFee(model, rate, i.amount, i.days), 0) * 100) / 100;
    if (!free && pick.length && fee < minFee) fee = Math.min(minFee, amount);
    return { amount, fee, free };
  }, [sel, invoices, model, rate, minFee, freeLeft]);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  if (!invoices.length) return <p className="py-6 text-center text-sm text-muted-foreground" data-testid="early-none">{t("noInvoices")}</p>;
  return (
    <div className="space-y-4" data-testid="early-form">
      <ul className="divide-y rounded-xl border">
        {invoices.map((i) => (
          <li key={i.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm ${i.eligible ? "" : "opacity-60"}`} data-testid="early-invoice">
            <label className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto sm:flex-1">
              <input type="checkbox" disabled={!i.eligible} checked={sel.has(i.id)} onChange={() => toggle(i.id)} data-testid="early-check" />
              <span className="min-w-0 break-all font-mono">{i.number}</span>
            </label>
            <span className="text-muted-foreground">{t("dueOn", { date: date(i.dueDate) })}</span>
            <span className="text-muted-foreground">{i.eligible ? t("daysEarly", { days: i.days }) : t("tooSoon")}</span>
            <span className="ml-auto font-medium tabular-nums">{money(i.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 rounded-xl bg-primary/5 p-3 text-sm sm:grid-cols-3" data-testid="early-quote">
        <div><div className="text-muted-foreground">{t("quoteAmount")}</div><div className="text-lg font-semibold tabular-nums">{money(q.amount)}</div></div>
        <div><div className="text-muted-foreground">{t("quoteFee")}</div><div className="text-lg font-semibold tabular-nums">{q.free && sel.size ? t("free") : money(q.fee)}</div><div className="text-xs text-muted-foreground">{t("plusVat")}</div></div>
        <div><div className="text-muted-foreground">{t("quoteNet")}</div><div className="text-lg font-semibold tabular-nums" data-testid="early-net">{money(Math.max(0, q.amount - Math.round(q.fee * (1 + vatRate / 100) * 100) / 100))}</div><div className="text-xs text-muted-foreground">{t("netNote")}</div></div>
      </div>
      {q.amount > room + 0.001 && <p className="text-sm text-destructive" role="alert">{t("overLimit", { room: money(room) })}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending || !sel.size || q.amount > room + 0.001} data-testid="early-request"
          onClick={() => run(() => requestEarlyPayAction({ ids: [...sel] }), () => setSel(new Set()), t("requested"))}><Spin on={pending} icon={Banknote} /> {t("request")}</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function CancelEarlyPayButton({ id }: { id: string }) {
  const t = useTranslations("plans");
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => cancelEarlyPayAction({ id }))} data-testid="early-cancel"><X className="size-4" /> {t("cancel")}</Button>
      <Msg error={error} />
    </span>
  );
}
