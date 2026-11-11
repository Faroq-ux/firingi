import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listTransfers } from "@/server/inventory/warehouse";
import { offerOptions, warehouseOptions } from "@/server/inventory/options";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Tone } from "@/components/ui/data-table";
import { TransferForm } from "@/components/inventory/controls";

export const metadata = { title: "Transfers" };
const TONE: Record<string, Tone> = { DRAFT: "secondary", IN_TRANSIT: "warning", RECEIVED: "success", CANCELLED: "outline" };

export default async function Transfers() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage"]);
  const [t, locale] = await Promise.all([getTranslations("inventory"), getLocale()]);
  const [rows, whs, offers] = await Promise.all([listTransfers(ctx), warehouseOptions(ctx), offerOptions(ctx, locale)]);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  return (
    <>
      <PageHeader title={t("transfers")} />
      {can(ctx, "vendor.inventory.manage") && whs.length > 1 && <Card className="mb-6"><CardHeader><CardTitle>{t("newTransfer")}</CardTitle></CardHeader><CardContent><TransferForm warehouses={whs} offers={offers} /></CardContent></Card>}
      <DataTable tableId="vendor.stock-transfers" testId="transfers-table" empty={t("empty")}
        columns={[{ key: "number", label: t("number") }, { key: "date", label: t("date"), type: "date" }, { key: "from", label: t("fromWh") }, { key: "to", label: t("toWh") }, { key: "qty", label: t("qty"), type: "number" }, { key: "received", label: t("received"), type: "number" }, { key: "status", label: t("statusLabel"), type: "badge", filter: true }]}
        rows={rows.map((r) => ({
          id: r.id, href: `/vendor/inventory/transfers/${r.id}`,
          cells: { number: { t: r.number, mono: true, href: `/vendor/inventory/transfers/${r.id}` }, date: { t: date.format(r.createdAt), v: r.createdAt.toISOString() }, from: r.from, to: r.to, qty: r.qty, received: r.status === "RECEIVED" ? r.received : null, status: { t: t(`transfer.${r.status}`), tone: TONE[r.status] } },
        }))} />
    </>
  );
}
