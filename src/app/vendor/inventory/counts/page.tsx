import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listCounts } from "@/server/inventory/warehouse";
import { offerOptions, warehouseOptions } from "@/server/inventory/options";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Tone } from "@/components/ui/data-table";
import { StartCountForm } from "@/components/inventory/controls";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Stock counts" };
const TONE: Record<string, Tone> = { OPEN: "default", SUBMITTED: "warning", APPROVED: "success", CANCELLED: "outline" };

export default async function Counts() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage"]);
  const [t, locale] = await Promise.all([getTranslations("inventory"), getLocale()]);
  const [rows, whs, offers] = await Promise.all([listCounts(ctx), warehouseOptions(ctx), offerOptions(ctx, locale)]);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  return (
    <>
      <PageHeader title={t("counts")} />
      {can(ctx, "vendor.inventory.manage") && <Card className="mb-6"><CardHeader><CardTitle>{t("startCount")}</CardTitle></CardHeader><CardContent><StartCountForm warehouses={whs} offers={offers} /></CardContent></Card>}
      <DataTable tableId="vendor.stock-counts" testId="counts-table" empty={t("empty")}
        columns={[{ key: "number", label: t("number") }, { key: "date", label: t("date"), type: "date" }, { key: "warehouse", label: t("warehouse") }, { key: "kind", label: t("type") }, { key: "progress", label: t("countedQty"), type: "number" }, { key: "variance", label: t("variance"), type: "money" }, { key: "status", label: t("statusLabel"), type: "badge", filter: true }]}
        rows={rows.map((c) => ({
          id: c.id, href: `/vendor/inventory/counts/${c.id}`,
          cells: {
            number: { t: c.number, mono: true, href: `/vendor/inventory/counts/${c.id}` }, date: { t: date.format(c.createdAt), v: c.createdAt.toISOString() }, warehouse: c.warehouse,
            kind: c.kind === "FULL" ? t("full") : t("cycle"), progress: { t: `${c.counted} / ${c.lines}`, v: c.counted },
            variance: c.varianceValue !== null ? { t: formatMoney(c.varianceValue, locale), v: Number(c.varianceValue) } : null, status: { t: t(`count.${c.status}`), tone: TONE[c.status] },
          },
        }))} />
    </>
  );
}
