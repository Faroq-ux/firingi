import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { buyerQuotes } from "@/server/buying/quotes";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { QUOTE_TONE as TONE } from "@/lib/buying";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Quotes" };


export default async function Quotes({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.place", "buyer.orders.view"]);
  const sp = await searchParams;
  const [t, locale] = await Promise.all([getTranslations("buying"), getLocale()]);
  const rows = await buyerQuotes(ctx);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  return (
    <>
      <PageHeader title={t("quotesTitle")} description={t("quotesIntro")} />
      {sp.sent && <Card className="mb-4 border-emerald-500/40"><CardContent className="pt-6 text-sm" role="status">{t("quotesSent")}</CardContent></Card>}
      <DataTable tableId="buy.quotes" testId="quotes-table" empty={t("noQuotes")}
        columns={[{ key: "number", label: t("quote") }, { key: "date", label: t("asked"), type: "date" }, { key: "supplier", label: t("supplier"), filter: true }, { key: "lines", label: t("products"), type: "number" }, { key: "total", label: t("quotedTotal"), type: "money" }, { key: "until", label: t("validUntil"), type: "date" }, { key: "status", label: t("statusLabel"), type: "badge", filter: true }]}
        rows={rows.map((q) => ({
          id: q.id, href: `/buy/orders/quotes/${q.id}`,
          cells: {
            number: { t: q.number, mono: true, href: `/buy/orders/quotes/${q.id}` }, date: { t: date.format(q.createdAt), v: q.createdAt.toISOString() }, supplier: q.supplier, lines: q.lines,
            total: q.total ? { t: formatMoney(q.total, locale), v: Number(q.total) } : null, until: q.validUntil ? { t: date.format(q.validUntil), v: q.validUntil.toISOString() } : null,
            status: { t: t(`qs.${q.status}`), tone: TONE[q.status] },
          },
        }))} />
    </>
  );
}
