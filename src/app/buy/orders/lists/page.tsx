import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myLists } from "@/server/buying/lists";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { NewList } from "@/components/buying/controls";

export const metadata = { title: "Order lists" };

export default async function Lists() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.place", "buyer.orders.view"]);
  const [t, locale] = await Promise.all([getTranslations("buying"), getLocale()]);
  const rows = await myLists(ctx);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  return (
    <>
      <PageHeader title={t("listsTitle")} description={t("listsIntro")} />
      <Card className="mb-6"><CardContent className="pt-6"><NewList /></CardContent></Card>
      <DataTable tableId="buy.lists" testId="lists-table" empty={t("noLists")}
        columns={[{ key: "name", label: t("name") }, { key: "items", label: t("products"), type: "number" }, { key: "units", label: t("units"), type: "number" }, { key: "who", label: t("visibility"), type: "badge", filter: true }, { key: "updated", label: t("updated"), type: "date" }]}
        rows={rows.map((l) => ({
          id: l.id, href: `/buy/orders/lists/${l.id}`,
          cells: {
            name: { t: l.name, href: `/buy/orders/lists/${l.id}`, sub: l.createdBy ?? undefined }, items: l.items, units: l.units,
            who: { t: l.shared ? t("team") : t("private"), tone: l.shared ? "default" : "outline" }, updated: { t: date.format(l.updatedAt), v: l.updatedAt.toISOString() },
          },
        }))} />
    </>
  );
}
