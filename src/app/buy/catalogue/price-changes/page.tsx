import Link from "next/link";
import { CalendarClock, TrendingDown, TrendingUp } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { buyerPriceChanges } from "@/server/price-intel/insights";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Tile } from "@/components/motion/dashboard-kit";
import { pickLocalized } from "@/i18n/config";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Price changes" };

export default async function BuyerPriceChanges() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.catalogue.view", "buyer.orders.place", "buyer.orders.view"]);
  const [d, t, locale] = await Promise.all([buyerPriceChanges(ctx), getTranslations("priceIntel"), getLocale()]);
  const name = (n: unknown) => pickLocalized(n as Record<string, string>, locale);
  const prod = (r: { product: unknown; packaging: unknown; offerId: string; minQty: number }) => ({ t: name(r.product), sub: `${name(r.packaging)}${r.minQty > 1 ? ` · ${t("fromQty", { qty: r.minQty })}` : ""}`, href: `/buy/catalogue/offers/${r.offerId}` });
  return (
    <>
      <PageHeader title={t("buyerTitle")} description={t("buyerIntro", { days: d.noticeDays })} icon={CalendarClock} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile icon={CalendarClock} label={t("upcomingTitle")} value={d.upcoming.length} locale={locale} tone="tone-orange" i={0} testId="kpi-upcoming" />
        <Tile icon={TrendingUp} label={t("recentUp")} value={d.recent.filter((r) => r.pct > 0).length} locale={locale} tone="tone-pink" i={1} />
        <Tile icon={TrendingDown} label={t("recentDown")} value={d.recent.filter((r) => r.pct < 0).length} locale={locale} tone="tone-teal" i={2} />
      </div>
      <Card className="mb-6">
        <CardHeader><CardTitle>{t("upcomingTitle")}</CardTitle><CardDescription>{t("upcomingHint")}</CardDescription></CardHeader>
        <CardContent>
          <DataTable tableId="buy.price-upcoming" testId="upcoming-changes" empty={t("upcomingEmpty")}
            columns={[{ key: "product", label: t("colProduct") }, { key: "supplier", label: t("colSupplier"), filter: true }, { key: "change", label: t("colChange") }, { key: "pct", label: "%", type: "number" }, { key: "from", label: t("colFrom"), type: "date" }]}
            rows={d.upcoming.map((r) => ({ id: r.id, cells: {
              product: prod(r), supplier: r.supplier, change: `${formatMoney(r.old, locale)} → ${formatMoney(r.new, locale)}`,
              pct: { t: `+${r.pct.toFixed(1)} %`, v: r.pct, tone: "warning" }, from: { t: formatDate(r.effectiveAt, locale), v: r.effectiveAt.getTime() },
            } }))} />
          {d.upcoming.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{t("upcomingTip")} <Link href="/buy/orders/lists" className="text-primary hover:underline">{t("toLists")}</Link></p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("recentTitle")}</CardTitle></CardHeader>
        <CardContent>
          <DataTable tableId="buy.price-recent" testId="recent-price-changes" empty={t("recentEmpty")}
            columns={[{ key: "at", label: t("colWhen"), type: "date" }, { key: "product", label: t("colProduct") }, { key: "supplier", label: t("colSupplier"), filter: true }, { key: "change", label: t("colChange") }, { key: "pct", label: "%", type: "number" }]}
            rows={d.recent.map((r) => ({ id: r.id, cells: {
              at: { t: formatDate(r.at, locale), v: r.at.getTime() }, product: prod(r), supplier: r.supplier, change: `${formatMoney(r.old, locale)} → ${formatMoney(r.new, locale)}`,
              pct: { t: `${r.pct > 0 ? "+" : ""}${r.pct.toFixed(1)} %`, v: r.pct, tone: r.pct > 0 ? "warning" : "success" },
            } }))} />
        </CardContent>
      </Card>
    </>
  );
}
