import { getLocale, getTranslations } from "next-intl/server";
import { AlertTriangle, Boxes, CircleDollarSign, ClipboardList, PackageX, TimerReset } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { inventorySummary, stockOverview } from "@/server/inventory/service";
import { offerOptions, warehouseOptions, offerLabel } from "@/server/inventory/options";
import { listViews } from "@/server/services/workspace";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Tone } from "@/components/ui/data-table";
import { Tile } from "@/components/motion/dashboard-kit";
import { ReceiveForm } from "@/components/inventory/controls";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Inventory" };
const TONE: Record<string, Tone> = { OK: "success", LOW: "warning", OUT: "destructive", EXPIRING: "warning", EXPIRED: "destructive" };

export default async function InventoryOverview({ searchParams }: { searchParams: Promise<{ wh?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.purchasing.manage"]);
  const sp = await searchParams;
  const [t, locale] = await Promise.all([getTranslations("inventory"), getLocale()]);
  const [sum, rows, offers, whs, views] = await Promise.all([inventorySummary(ctx), stockOverview(ctx, { addressId: sp.wh || undefined }), offerOptions(ctx, locale), warehouseOptions(ctx), listViews(ctx, "vendor.inventory")]);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  return (
    <>
      <PageHeader title={t("stock")} description={t("method")} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6" data-testid="inventory-kpis">
        <Tile icon={CircleDollarSign} label={t("kpiValue")} value={Number(sum.value)} fmt="money" locale={locale} tone="tone-violet" i={0} href="/vendor/inventory/valuation" />
        <Tile icon={Boxes} label={t("kpiUnits")} value={sum.units} locale={locale} tone="tone-blue" i={1} />
        <Tile icon={AlertTriangle} label={t("kpiLow")} value={sum.low} locale={locale} tone="tone-orange" i={2} href="/vendor/inventory/reorder" />
        <Tile icon={TimerReset} label={t("kpiExpiring")} value={sum.expiring} locale={locale} tone="tone-pink" i={3} href="/vendor/inventory/expiry?days=14" />
        <Tile icon={PackageX} label={t("kpiExpired")} value={sum.expired} locale={locale} tone="tone-pink" i={4} href="/vendor/inventory/expiry?days=0" />
        <Tile icon={ClipboardList} label={t("kpiOpenPos")} value={sum.openPos} locale={locale} tone="tone-teal" i={5} href="/vendor/inventory/purchase-orders" />
      </div>
      {whs.length > 1 && (
        <nav className="mb-3 flex flex-wrap gap-2 text-sm" aria-label={t("warehouse")}>
          {[{ id: "", label: t("allWarehouses") }, ...whs].map((w) => (
            <a key={w.id} href={w.id ? `?wh=${w.id}` : "?"} className={`rounded-full border px-3 py-1 ${(sp.wh ?? "") === w.id ? "border-primary bg-primary/10 font-medium" : ""}`}>{w.label}</a>
          ))}
        </nav>
      )}
      <DataTable tableId="vendor.inventory" views={views} testId="inventory-table" empty={t("empty")} exportName="inventory"
        columns={[
          { key: "product", label: t("product") }, { key: "warehouse", label: t("warehouse"), filter: true },
          { key: "onHand", label: t("onHand"), type: "number" }, { key: "reserved", label: t("reserved"), type: "number", hidden: true }, { key: "free", label: t("free"), type: "number" },
          { key: "incoming", label: t("incoming"), type: "number" }, { key: "avgCost", label: t("avgCost"), type: "money" }, { key: "value", label: t("value"), type: "money" },
          { key: "bestBefore", label: t("bestBefore"), type: "date" }, { key: "status", label: t("statusLabel"), type: "badge", filter: true },
        ]}
        rows={rows.map((r) => ({
          id: `${r.offer.id}-${r.addressId}`, href: `/vendor/inventory/stock/${r.offer.id}`,
          cells: {
            product: { t: offerLabel(r.offer.product, r.offer.packaging, r.offer.sku, locale) }, warehouse: r.warehouse,
            onHand: r.onHand, reserved: r.reserved, free: r.usable, incoming: r.incoming || null,
            avgCost: { t: Number(r.avgCost) ? formatMoney(r.avgCost, locale) : "—", v: Number(r.avgCost) },
            value: { t: formatMoney(r.value, locale), v: Number(r.value) },
            bestBefore: r.nextExpiry ? { t: date.format(r.nextExpiry), v: r.nextExpiry.toISOString(), sub: (r.daysLeft ?? 0) < 0 ? t("status.EXPIRED") : t("daysLeft", { days: r.daysLeft ?? 0 }), tone: (r.daysLeft ?? 0) < 0 ? "destructive" : undefined } : null,
            status: { t: t(`status.${r.status}`), tone: TONE[r.status] },
          },
        }))} />
      {can(ctx, "vendor.inventory.manage") && (
        <Card className="mt-6">
          <CardHeader><CardTitle>{t("receiveTitle")}</CardTitle><CardDescription>{t("receiveHint")}</CardDescription></CardHeader>
          <CardContent><ReceiveForm offers={offers} warehouses={whs} /></CardContent>
        </Card>
      )}
    </>
  );
}
