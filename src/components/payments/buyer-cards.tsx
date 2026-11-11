import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PayInvoicesForm } from "./pay-invoices";
import type { Ctx } from "@/server/context";
import { buyerPaymentOverview } from "@/server/payments/service";

/** Invoices page: pay open invoices online (+ credit balance, direct debit hint). */
export async function BuyerPayCard({ ctx }: { ctx: Ctx }) {
  const [o, t, locale] = await Promise.all([buyerPaymentOverview(ctx), getTranslations("pay"), getLocale()]);
  const money = (v: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(Number(v));
  if (!o.canPay || (!o.invoices.length && Number(o.credit) <= 0)) return null;
  return (
    <Card className="mb-4" data-testid="buyer-pay-card">
      <CardHeader><CardTitle>{t("payInvoices")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {Number(o.credit) > 0 && <p className="rounded-md bg-success/10 p-2 text-sm" data-testid="credit-balance">{t("credit", { amount: money(o.credit) })}</p>}
        {o.mandate?.autoCollect && <p className="text-sm text-muted-foreground">{t("dd.collectedAuto", { last4: o.mandate.ibanLast4 ?? "····" })}</p>}
        {o.invoices.length > 0 && <><p className="text-sm text-muted-foreground">{t("selectInvoices")}</p><PayInvoicesForm invoices={o.invoices} /></>}
        {!o.mandate && <p className="text-xs text-muted-foreground"><Link href="/buy/finance/direct-debit" className="text-primary underline">{t("setUpDebit")}</Link></p>}
      </CardContent>
    </Card>
  );
}

/** Payments page: references to pay and other payments in progress. */
export async function BuyerPaymentsInProgress({ ctx }: { ctx: Ctx }) {
  const [o, t, locale] = await Promise.all([buyerPaymentOverview(ctx), getTranslations("pay"), getLocale()]);
  if (!o.inProgress.length && Number(o.credit) <= 0) return null;
  const money = (v: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(Number(v));
  return (
    <Card className="mb-4" data-testid="payments-in-progress">
      <CardHeader><CardTitle>{t("pendingPayments")}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {Number(o.credit) > 0 && <p className="rounded-md bg-success/10 p-2">{t("credit", { amount: money(o.credit) })}</p>}
        <ul className="divide-y">
          {o.inProgress.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><span className="font-medium">{r.method ? t(`methods.${r.method}`) : ""}</span> · <span className="font-mono text-xs">{r.docs}</span></span>
              <span className="flex items-center gap-3">
                {r.action?.type === "multibanco" && <span className="font-mono text-xs">{t("entity")} {r.action.entity} · {t("reference")} {r.action.reference}</span>}
                <span className="tabular-nums">{money(r.amount)}</span>
                <Link href={`/buy/finance/pay/${r.id}`} className="text-primary underline">{t("open")}</Link>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
