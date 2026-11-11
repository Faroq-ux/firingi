import { getLocale, getTranslations } from "next-intl/server";
import { ClipboardList, PackageCheck, ScanLine, Timer } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { pickableOrders, pickLists, warehouseOptions } from "@/server/warehouse/picking";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Tone } from "@/components/ui/data-table";
import { Tile } from "@/components/motion/dashboard-kit";
import { NewPickList } from "@/components/warehouse/controls";

export const metadata = { title: "Pick & pack" };
const TONE: Record<string, Tone> = { OPEN: "warning", PICKED: "default", PACKED: "success", CANCELLED: "outline" };

export default async function PickPack({ searchParams }: { searchParams: Promise<{ wh?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.warehouse.pick", "vendor.inventory.manage", "vendor.inventory.view"]);
  const sp = await searchParams;
  const [t, locale] = await Promise.all([getTranslations("warehouse"), getLocale()]);
  const whs = (await warehouseOptions(ctx)).map((w) => ({ id: w.id, label: w.label }));
  const addressId = whs.find((w) => w.id === sp.wh)?.id ?? whs[0]?.id;
  const canPick = can(ctx, ["vendor.warehouse.pick", "vendor.inventory.manage"]);
  const [lists, orders] = await Promise.all([pickLists(ctx), addressId && canPick ? pickableOrders(ctx, addressId) : Promise.resolve([])]);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const short = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" });
  const today = new Date().toDateString();
  return (
    <>
      <PageHeader title={t("pickTitle")} description={t("pickIntro")} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="pick-kpis">
        <Tile icon={Timer} label={t("kpiWaiting")} value={orders.length} locale={locale} tone="tone-orange" i={0} />
        <Tile icon={ScanLine} label={t("kpiPicking")} value={lists.filter((l) => l.status === "OPEN").length} locale={locale} tone="tone-blue" i={1} />
        <Tile icon={ClipboardList} label={t("kpiToPack")} value={lists.filter((l) => l.status === "PICKED").length} locale={locale} tone="tone-violet" i={2} />
        <Tile icon={PackageCheck} label={t("kpiPackedToday")} value={lists.filter((l) => l.status === "PACKED" && l.createdAt.toDateString() === today).length} locale={locale} tone="tone-teal" i={3} />
      </div>
      {canPick && addressId && (
        <Card className="mb-6">
          <CardHeader><CardTitle>{t("newPickList")}</CardTitle><CardDescription>{t("newPickListHint")}</CardDescription></CardHeader>
          <CardContent>
            <NewPickList warehouses={whs} addressId={addressId} orders={orders.map((o) => ({ id: o.id, number: o.number, buyer: o.buyer, city: o.city, units: o.units, lines: o.lines, due: o.requestedDeliveryDate ? short.format(o.requestedDeliveryDate) : null }))} />
          </CardContent>
        </Card>
      )}
      <DataTable tableId="vendor.pick-lists" testId="pick-lists" empty={t("noPickLists")}
        columns={[{ key: "number", label: t("pickList") }, { key: "created", label: t("created"), type: "date" }, { key: "warehouse", label: t("warehouse"), filter: true }, { key: "orders", label: t("orders"), type: "number" }, { key: "progress", label: t("progress"), type: "number" }, { key: "short", label: t("shortLines"), type: "number", hidden: true }, { key: "status", label: t("statusLabel"), type: "badge", filter: true }]}
        rows={lists.map((l) => ({
          id: l.id, href: `/vendor/warehouse/pick/${l.id}`,
          cells: {
            number: { t: l.number, mono: true, href: `/vendor/warehouse/pick/${l.id}` }, created: { t: date.format(l.createdAt), v: l.createdAt.toISOString() }, warehouse: l.warehouse, orders: l.orders,
            progress: { t: `${l.done} / ${l.lines}`, v: l.lines ? l.done / l.lines : 0, sub: t("unitsN", { count: l.picked }) }, short: l.short || null, status: { t: t(`pl.${l.status}`), tone: TONE[l.status] },
          },
        }))} />
    </>
  );
}
