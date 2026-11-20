import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarClock } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myPayLater } from "@/server/pay-later/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { feeFor } from "@/lib/pay-later";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Pay Later" };
export const dynamic = "force-dynamic";

export default async function PayLaterPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.invoices.view", "buyer.orders.place"]);
  const [t, locale, m] = await Promise.all([getTranslations("payLater"), getLocale(), myPayLater(ctx)]);
  const money = (n: number) => formatMoney(n, locale);
  const tone = (s: string) => (s === "PAID" ? "success" : s === "OVERDUE" ? "destructive" : s === "CANCELLED" ? "secondary" : "warning") as "success" | "destructive" | "secondary" | "warning";
  const termText = (x: { kind: string; days: number; count: number }) => (x.kind === "DAYS" ? t("termDays", { days: x.days }) : t("termInstalments", { count: x.count }));
  return (
    <>
      <PageHeader title={t("title")} icon={CalendarClock} description={t("intro")} />
      {!m.access.ok && <p className="mb-4 rounded-xl border border-dashed p-4 text-sm" data-testid="pl-closed">{t(`closed.${m.access.why}`)}</p>}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("howTitle")}</CardTitle><CardDescription>{t("howIntro")}</CardDescription></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {m.own && (
              <div className="grid grid-cols-3 gap-2" data-testid="pl-own">
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{t("limit")}</p><p className="font-semibold tabular-nums">{money(m.own.limit)}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{t("used")}</p><p className="font-semibold tabular-nums">{money(m.own.used)}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{t("left")}</p><p className="font-semibold tabular-nums" data-testid="pl-left">{money(m.own.left)}</p></div>
              </div>
            )}
            {m.partner && <p className="rounded-lg bg-muted/50 p-3">{t("partnerOn")}</p>}
            <p className="text-xs text-muted-foreground">{t("ownNote")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("optionsTitle")}</CardTitle><CardDescription>{t("optionsIntro")}</CardDescription></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" data-testid="pl-terms">
              {m.terms.map((x) => {
                const f = feeFor(x, 1000);
                return <li key={x.id} className="flex flex-wrap justify-between gap-2 py-2"><span className="font-medium">{termText(x)}</span><span className="text-muted-foreground">{f.buyer > 0 ? t("feeExample", { amount: money(f.buyer) }) : t("noFee")}</span></li>;
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>{t("plansTitle")}</CardTitle></CardHeader>
        <CardContent>
          {!m.plans.length ? <p className="py-6 text-center text-sm text-muted-foreground">{t("noPlans")}</p> : (
            <ul className="divide-y" data-testid="pl-plans">
              {m.plans.map((p) => (
                <li key={p.id} className="space-y-2 py-3 text-sm" data-testid="pl-plan" data-status={p.status}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/buy/orders/${p.order.id}`} className="font-medium text-primary hover:underline">{p.order.number}</Link>
                    <Badge variant={tone(p.status)}>{t(`status.${p.status}`)}</Badge>
                    <span className="text-xs text-muted-foreground">{termText(p.term)} · {money(p.amount)}{p.buyerFee > 0 ? ` · ${t("feeIncl", { amount: money(p.buyerFee) })}` : ""}</span>
                    {p.invoice && <Link href="/buy/finance/invoices" className="ml-auto text-xs text-primary hover:underline">{t("invoice")} {p.invoice.fullNumber ?? ""}</Link>}
                  </div>
                  {p.model === "PARTNER" && p.status !== "CANCELLED" && <p className="text-xs text-muted-foreground">{t("partnerNote")}</p>}
                  {p.instalments.length > 0 && (
                    <ul className="flex flex-wrap gap-2">
                      {p.instalments.map((i) => (
                        <li key={i.n} className={`rounded-lg border px-2 py-1 text-xs ${i.overdue ? "border-destructive text-destructive" : ""}`} data-testid="pl-instalment">
                          {t("payment", { n: i.n })} · {money(i.amount)} · {i.paidAt ? t("paid") : i.overdue ? t("overdueOn", { date: formatDate(i.dueAt, locale) }) : t("dueOn", { date: formatDate(i.dueAt, locale) })}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          {m.plans.some((p) => p.model === "OWN" && (p.status === "INVOICED" || p.status === "OVERDUE")) && <Link href="/buy/finance/pay" className="mt-3 inline-block text-sm text-primary hover:underline">{t("payNowLink")} →</Link>}
        </CardContent>
      </Card>
    </>
  );
}
