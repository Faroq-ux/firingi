import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listPurchaseOrders } from "@/server/inventory/purchasing";
import { listViews } from "@/server/services/workspace";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { DataTable, type Tone } from "@/components/ui/data-table";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Purchase orders" };
const TONE: Record<string, Tone> = { DRAFT: "secondary", SENT: "default", PARTIALLY_RECEIVED: "warning", RECEIVED: "success", CANCELLED: "outline" };

export default async function PurchaseOrders() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.purchasing.manage", "vendor.inventory.view", "vendor.inventory.manage"]);
  const [t, locale] = await Promise.all([getTranslations("inventory"), getLocale()]);
  const [rows, views] = await Promise.all([listPurchaseOrders(ctx), listViews(ctx, "vendor.purchase-orders")]);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  return (
    <>
      <PageHeader title={t("purchaseOrders")} actions={can(ctx, "vendor.purchasing.manage") ? <Link className={buttonVariants()} href="/vendor/inventory/purchase-orders/new" data-testid="new-po"><Plus className="size-4" />{t("newPo")}</Link> : undefined} />
      <DataTable tableId="vendor.purchase-orders" views={views} testId="po-table" empty={t("empty")} exportName="purchase-orders"
        columns={[
          { key: "number", label: t("number") }, { key: "date", label: t("date"), type: "date" }, { key: "from", label: t("from"), filter: true },
          { key: "warehouse", label: t("receiveInto"), filter: true }, { key: "expected", label: t("expected"), type: "date" },
          { key: "progress", label: t("received"), type: "number" }, { key: "total", label: t("total"), type: "money" }, { key: "status", label: t("statusLabel"), type: "badge", filter: true },
        ]}
        rows={rows.map((p) => ({
          id: p.id, href: `/vendor/inventory/purchase-orders/${p.id}`,
          cells: {
            number: { t: p.number, mono: true, href: `/vendor/inventory/purchase-orders/${p.id}` }, date: { t: date.format(p.createdAt), v: p.createdAt.toISOString() },
            from: { t: p.from, sub: p.viaFiringi ? `FIRINGI${p.viaOrder ? ` · ${p.viaOrder.number}` : ""}` : undefined }, warehouse: p.warehouse,
            expected: p.expectedOn ? { t: date.format(p.expectedOn), v: p.expectedOn.toISOString() } : null,
            progress: { t: `${p.received} / ${p.qty}`, v: p.qty ? p.received / p.qty : 0 }, total: { t: formatMoney(p.total, locale), v: Number(p.total) },
            status: { t: t(`po.${p.status}`), tone: TONE[p.status] },
          },
        }))} />
    </>
  );
}
