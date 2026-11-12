import { getLocale, getTranslations } from "next-intl/server";
import { FileQuestion, Hourglass, Handshake } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { supplierQuotes } from "@/server/buying/quotes";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";
import { Tile } from "@/components/motion/dashboard-kit";
import { QUOTE_TONE } from "@/lib/buying";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Quote requests" };

export default async function VendorQuotes() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.pricing.manage", "vendor.orders.manage", "vendor.orders.view"]);
  const [t, locale] = await Promise.all([getTranslations("buying"), getLocale()]);
  const rows = await supplierQuotes(ctx);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  const won = rows.filter((r) => r.status === "ACCEPTED");
  return (
    <>
      <PageHeader title={t("vendorQuotesTitle")} description={t("vendorQuotesIntro")} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="quote-kpis">
        <Tile icon={FileQuestion} label={t("kpiToAnswer")} value={rows.filter((r) => r.status === "REQUESTED").length} locale={locale} tone="tone-orange" i={0} />
        <Tile icon={Hourglass} label={t("kpiWaitingBuyer")} value={rows.filter((r) => r.status === "QUOTED").length} locale={locale} tone="tone-blue" i={1} />
        <Tile icon={Handshake} label={t("kpiWon")} value={won.length} locale={locale} tone="tone-teal" i={2} />
      </div>
      <DataTable tableId="vendor.quotes" testId="vendor-quotes-table" empty={t("noQuotes")}
        columns={[{ key: "number", label: t("quote") }, { key: "date", label: t("asked"), type: "date" }, { key: "buyer", label: t("customer"), filter: true }, { key: "lines", label: t("products"), type: "number" }, { key: "needed", label: t("neededBy"), type: "date" }, { key: "total", label: t("quotedTotal"), type: "money" }, { key: "status", label: t("statusLabel"), type: "badge", filter: true }]}
        rows={rows.map((q) => ({
          id: q.id, href: `/vendor/orders/quotes/${q.id}`,
          cells: {
            number: { t: q.number, mono: true, href: `/vendor/orders/quotes/${q.id}` }, date: { t: date.format(q.createdAt), v: q.createdAt.toISOString() }, buyer: q.buyer, lines: q.lines,
            needed: q.neededBy ? { t: date.format(q.neededBy), v: q.neededBy.toISOString() } : null, total: q.total ? { t: formatMoney(q.total, locale), v: Number(q.total) } : null,
            status: { t: t(`qs.${q.status}`), tone: QUOTE_TONE[q.status] },
          },
        }))} />
    </>
  );
}
