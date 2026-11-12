import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { supplierQuote } from "@/server/buying/quotes";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AnswerQuote } from "@/components/buying/controls";
import { QUOTE_TONE, badgeVariant } from "@/lib/buying";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Quote request" };

export default async function VendorQuote({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.pricing.manage", "vendor.orders.manage", "vendor.orders.view"]);
  const [t, locale] = await Promise.all([getTranslations("buying"), getLocale()]);
  const q = await supplierQuote(ctx, (await params).id, locale);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  return (
    <>
      <PageHeader title={`${t("quote")} ${q.number}`} description={`${q.buyer} · ${date.format(q.createdAt)}${q.neededBy ? ` · ${t("neededByDate", { date: date.format(q.neededBy) })}` : ""}`} actions={<Badge variant={badgeVariant(QUOTE_TONE[q.status])} data-testid="quote-status">{t(`qs.${q.status}`)}</Badge>} />
      {q.note && <Card className="mb-4"><CardContent className="pt-6 text-sm"><span className="text-muted-foreground">{t("buyerNote")}:</span> {q.note}</CardContent></Card>}
      <Card>
        <CardHeader><CardTitle>{q.canAnswer ? (q.status === "QUOTED" ? t("changeQuote") : t("answerTitle")) : t("products")}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {q.canAnswer ? (
            <AnswerQuote id={q.id} lines={q.lines} commissionRate={q.commissionRate} validUntil={q.validUntil ? q.validUntil.toISOString().slice(0, 10) : null} note={q.supplierNote} locale={locale} />
          ) : (
            <>
              <ul className="divide-y rounded-xl border">{q.lines.map((l) => <li key={l.id} className="flex flex-wrap justify-between gap-2 px-3 py-2"><span>{l.product} · {l.packaging} × {l.qty}</span><span className="tabular-nums">{l.quotedUnitNet ? formatMoney(l.quotedUnitNet, locale) : "—"}</span></li>)}</ul>
              {q.status !== "REQUESTED" && <p>{t("quotedTotal")}: <b>{formatMoney(q.total, locale)}</b> · {t("youReceive", { rate: Number(q.commissionRate).toLocaleString(locale) })}: <b>{formatMoney(q.payout, locale)}</b></p>}
              {q.decisionNote && <p><span className="text-muted-foreground">{t("reason")}:</span> {q.decisionNote}</p>}
              {q.orderId && <Link className="font-medium text-primary underline" href={`/vendor/orders/${q.orderId}`}>{t("openOrder")}</Link>}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
