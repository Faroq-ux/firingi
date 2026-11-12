import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { buyerQuote } from "@/server/buying/quotes";
import { deliveryAddressOptions } from "@/server/inventory/options";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AcceptQuote, WithdrawQuote } from "@/components/buying/controls";
import { formatMoney } from "@/lib/utils";
import { QUOTE_TONE as TONE } from "@/lib/buying";

export const metadata = { title: "Quote" };

export default async function QuotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.place", "buyer.orders.view"]);
  const sp = await searchParams;
  const [t, locale] = await Promise.all([getTranslations("buying"), getLocale()]);
  const q = await buyerQuote(ctx, (await params).id, locale);
  const addresses = q.canAccept ? await deliveryAddressOptions(ctx) : [];
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  const quoted = q.status !== "REQUESTED" && q.lines.every((l) => l.quotedUnitNet);
  const saving = quoted ? Number(q.listTotal) - Number(q.total) : 0;
  return (
    <>
      <PageHeader title={`${t("quote")} ${q.number}`} description={`${q.supplier} · ${date.format(q.createdAt)}`} actions={<Badge variant={TONE[q.status] === "success" ? "success" : TONE[q.status] === "destructive" ? "destructive" : "outline"} data-testid="quote-status">{t(`qs.${q.status}`)}</Badge>} />
      {sp.sent && <Card className="mb-4 border-emerald-500/40"><CardContent className="pt-6 text-sm" role="status">{t("quoteSent")}</CardContent></Card>}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader><CardTitle>{t("products")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="quote-lines">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3 font-medium">{t("product")}</th><th className="py-1 pr-3 text-right font-medium">{t("qty")}</th><th className="py-1 pr-3 text-right font-medium">{t("yourPrice")}</th><th className="py-1 pr-3 text-right font-medium">{t("quotedPrice")}</th><th className="py-1 text-right font-medium">{t("lineTotal")}</th></tr></thead>
                <tbody>
                  {q.lines.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="py-2 pr-3"><div className="font-medium">{l.product}</div><div className="text-xs text-muted-foreground">{l.packaging}{l.targetUnitNet ? ` · ${t("target")} ${formatMoney(l.targetUnitNet, locale)}` : ""}</div></td>
                      <td className="py-2 pr-3 text-right tabular-nums">{l.qty}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{formatMoney(l.listUnitNet, locale)}</td>
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums">{l.quotedUnitNet ? formatMoney(l.quotedUnitNet, locale) : "—"}</td>
                      <td className="py-2 text-right tabular-nums">{l.quotedUnitNet ? formatMoney(Number(l.quotedUnitNet) * l.qty, locale) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {quoted && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/30 p-3 text-sm">
                <span>{t("quotedTotal")} ({t("exclVat")}): <b className="tabular-nums" data-testid="quote-total">{formatMoney(q.total, locale)}</b></span>
                {saving > 0 && <span className="text-[color:var(--success,#16a34a)]">{t("youSave", { amount: formatMoney(saving, locale) })}</span>}
              </div>
            )}
            {q.note && <p className="text-sm"><span className="text-muted-foreground">{t("yourNote")}:</span> {q.note}</p>}
            {q.supplierNote && <p className="text-sm"><span className="text-muted-foreground">{t("supplierNote")}:</span> {q.supplierNote}</p>}
            {q.decisionNote && <p className="text-sm"><span className="text-muted-foreground">{t("reason")}:</span> {q.decisionNote}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{q.status === "QUOTED" ? t("acceptTitle") : t("whatNext")}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {q.status === "REQUESTED" && <p>{t("waitingSupplier")}{q.neededBy ? ` ${t("neededByDate", { date: date.format(q.neededBy) })}` : ""}</p>}
            {q.status === "QUOTED" && q.validUntil && <p>{t("validUntilDate", { date: date.format(q.validUntil) })}</p>}
            {q.canAccept && <AcceptQuote id={q.id} addresses={addresses} />}
            {q.status === "ACCEPTED" && q.orderId && <Link href={`/buy/orders/${q.orderId}`} className="font-medium text-primary underline">{t("openOrder")}</Link>}
            {q.status === "EXPIRED" && <p>{t("expiredHint")}</p>}
            {q.status === "REQUESTED" && <WithdrawQuote id={q.id} />}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
