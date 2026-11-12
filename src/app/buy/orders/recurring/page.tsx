import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listRecurring } from "@/server/buying/recurring";
import { myLists } from "@/server/buying/lists";
import { deliveryAddressOptions } from "@/server/inventory/options";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { NewRecurring } from "@/components/buying/controls";
import { RECURRING_TONE } from "@/lib/buying";

export const metadata = { title: "Recurring orders" };

export default async function Recurring({ searchParams }: { searchParams: Promise<{ list?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.place", "buyer.orders.view"]);
  const sp = await searchParams;
  const [t, locale] = await Promise.all([getTranslations("buying"), getLocale()]);
  const canPlace = ctx.permissions.has("buyer.orders.place");
  const [rows, lists, addresses] = await Promise.all([listRecurring(ctx), myLists(ctx), canPlace ? deliveryAddressOptions(ctx) : Promise.resolve([])]);
  const date = new Intl.DateTimeFormat(locale, { weekday: "short", day: "2-digit", month: "short" });
  const when = (r: (typeof rows)[number]) => (r.frequency === "MONTHLY" ? t("monthlyOn", { day: r.dayOfMonth ?? 1 }) : t(r.frequency === "WEEKLY" ? "weeklyOn" : "biweeklyOn", { day: t(`day.${r.weekday ?? 1}`) }));
  return (
    <>
      <PageHeader title={t("recurringTitle")} description={t("recurringIntro")} />
      {canPlace && (
        <Card className="mb-6">
          <CardHeader><CardTitle>{t("newRecurring")}</CardTitle><CardDescription>{t("newRecurringHint")}</CardDescription></CardHeader>
          <CardContent><NewRecurring addresses={addresses} lists={lists.map((l) => ({ id: l.id, label: l.name }))} defaultList={sp.list} /></CardContent>
        </Card>
      )}
      <DataTable tableId="buy.recurring" testId="recurring-table" empty={t("noRecurring")}
        columns={[{ key: "name", label: t("name") }, { key: "when", label: t("schedule") }, { key: "next", label: t("nextOrder"), type: "date" }, { key: "items", label: t("products"), type: "number" }, { key: "last", label: t("lastRun") }, { key: "status", label: t("statusLabel"), type: "badge", filter: true }]}
        rows={rows.map((r) => ({
          id: r.id, href: `/buy/orders/recurring/${r.id}`,
          cells: {
            name: { t: r.name, href: `/buy/orders/recurring/${r.id}`, sub: r.createdBy ?? undefined }, when: when(r),
            next: r.status === "ACTIVE" ? { t: date.format(r.nextRunAt), v: r.nextRunAt.toISOString(), sub: r.skipNext ? t("willSkip") : undefined } : null,
            items: r.items, last: r.lastResult ? { t: t(`run.${r.lastResult}`), tone: r.lastResult === "FAILED" ? "destructive" : r.lastResult === "PLACED" ? "success" : "outline" } : "—",
            status: { t: t(`rs.${r.status}`), tone: RECURRING_TONE[r.status] },
          },
        }))} />
    </>
  );
}
