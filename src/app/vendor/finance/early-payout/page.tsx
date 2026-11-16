import { Banknote } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myEarlyPay } from "@/server/plans/early-pay";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CancelEarlyPayButton, EarlyPayForm } from "@/components/plans/vendor";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Early Payout" };
export const dynamic = "force-dynamic";

const TONE = { REQUESTED: "secondary", PAID: "success", REJECTED: "destructive", CANCELLED: "outline" } as const;

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.invoices.view", "vendor.payments.view"]);
  const [o, t, locale] = await Promise.all([myEarlyPay(ctx), getTranslations("plans"), getLocale()]);
  const money = (n: number | string) => formatMoney(String(n), locale);
  const terms = o.model === "PER_DAY" ? t("earlyPerDay", { rate: o.rate.toLocaleString(locale), min: money(o.minFee) }) : o.model === "FLAT" ? t("earlyFlat", { rate: o.rate.toLocaleString(locale), min: money(o.minFee) }) : t("earlyOff");
  return (
    <>
      <PageHeader title={t("earlyTitle")} description={t("earlyIntro")} icon={Banknote} />
      {!o.available ? (
        <Card className="mb-4"><CardContent className="pt-6 text-sm" data-testid="early-unavailable">{t(`why.${o.why}`)}</CardContent></Card>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="early-summary">
            {([[t("terms"), terms], [t("limit"), money(o.limit)], [t("outstanding"), money(o.outstanding)], [t("room"), money(o.room)]] as const).map(([l, v]) => (
              <Card key={l}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{l}</p><p className="text-sm font-semibold">{v}</p></CardContent></Card>
            ))}
          </div>
          {o.freeLeft > 0 && <p className="mb-4 rounded-md bg-[var(--success,#16a34a)]/10 p-3 text-sm" data-testid="early-free">{t("freeLeft", { n: o.freeLeft })}</p>}
          <Card className="mb-4">
            <CardHeader><CardTitle>{t("chooseInvoices")}</CardTitle></CardHeader>
            <CardContent>
              <EarlyPayForm invoices={o.invoices.map((i) => ({ id: i.id, number: i.number, dueDate: i.dueDate.toISOString(), days: i.days, amount: i.amount, fee: i.fee, eligible: i.eligible }))}
                model={o.model} rate={o.rate} minFee={o.minFee} freeLeft={o.freeLeft} room={o.room} vatRate={o.vatRate} locale={locale} />
              <p className="mt-3 text-xs text-muted-foreground">{t("howItWorks", { days: o.minDaysEarly })}</p>
            </CardContent>
          </Card>
        </>
      )}
      <Card>
        <CardHeader><CardTitle>{t("history")}</CardTitle></CardHeader>
        <CardContent>
          {!o.history.length ? <p className="text-sm text-muted-foreground">{t("noHistory")}</p> : (
            <ul className="divide-y text-sm" data-testid="early-history">
              {o.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5" data-testid="early-row">
                  <span className="font-mono font-medium">{h.number}</span>
                  <Badge variant={TONE[h.status]} data-testid="early-status">{t(`status.${h.status}`)}</Badge>
                  <span className="text-muted-foreground">{formatDate(h.createdAt, locale)}</span>
                  <span>{t("rowAmount", { amount: money(h.amount.toString()), fee: Number(h.fee) > 0 ? money(h.fee.toString()) : t("free") })}</span>
                  {h.status === "PAID" && <span className="font-medium">{t("rowNet", { net: money(h.net.toString()) })}</span>}
                  {h.feeInvoice && <a className="font-mono text-primary hover:underline" href={`/api/invoices/${h.feeInvoice.id}/pdf`} target="_blank" rel="noreferrer">{h.feeInvoice.fullNumber}</a>}
                  {h.reason && <span className="text-muted-foreground">{h.reason}</span>}
                  {h.status === "REQUESTED" && <span className="ml-auto"><CancelEarlyPayButton id={h.id} /></span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
