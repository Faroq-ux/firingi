import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { movements } from "@/server/inventory/service";
import { offerLabel } from "@/server/inventory/options";
import { listViews } from "@/server/services/workspace";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable, type Tone } from "@/components/ui/data-table";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Stock movements" };
const TONE: Record<string, Tone> = { RECEIPT: "success", TRANSFER_IN: "success", RETURN: "success", SHIPMENT: "default", TRANSFER_OUT: "secondary", WRITE_OFF: "destructive", COUNT: "warning", ADJUSTMENT: "warning" };

export default async function Movements() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.purchasing.manage"]);
  const [t, locale] = await Promise.all([getTranslations("inventory"), getLocale()]);
  const [rows, views] = await Promise.all([movements(ctx, { take: 1000 }), listViews(ctx, "vendor.stock-movements")]);
  const when = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <>
      <PageHeader title={t("movements")} description={t("method")} />
      <DataTable tableId="vendor.stock-movements" views={views} testId="movements-table" empty={t("empty")} exportName="stock-movements"
        columns={[
          { key: "at", label: t("date"), type: "date" }, { key: "type", label: t("type"), type: "badge", filter: true }, { key: "product", label: t("product") },
          { key: "warehouse", label: t("warehouse"), filter: true }, { key: "lot", label: t("lot") }, { key: "qty", label: t("qty"), type: "number" },
          { key: "unitCost", label: t("avgCost"), type: "money", hidden: true }, { key: "value", label: t("value"), type: "money" }, { key: "ref", label: t("reference") }, { key: "by", label: t("by"), hidden: true },
        ]}
        rows={rows.map((m) => ({
          id: m.id,
          cells: {
            at: { t: when.format(m.at), v: m.at.toISOString() }, type: { t: t(`move.${m.type}`), tone: TONE[m.type] },
            product: { t: offerLabel(m.offer.product, m.offer.packaging, m.offer.sku, locale), href: `/vendor/inventory/stock/${m.offer.id}` }, warehouse: m.warehouse, lot: m.lotCode,
            qty: m.qty, unitCost: m.unitCost ? { t: formatMoney(m.unitCost, locale), v: Number(m.unitCost) } : null, value: m.value ? { t: formatMoney(m.value, locale), v: Number(m.value) } : null,
            ref: m.order ? { t: m.order.number, href: `/vendor/orders/${m.order.id}`, mono: true } : m.note, by: m.by,
          },
        }))} />
    </>
  );
}
