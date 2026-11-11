import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { reorderSuggestions } from "@/server/inventory/service";
import { listSuppliers } from "@/server/inventory/purchasing";
import { offerLabel } from "@/server/inventory/options";
import { PageHeader } from "@/components/layout/page-header";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ReorderTable } from "@/components/inventory/controls";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Reorder" };

export default async function Reorder() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.purchasing.manage"]);
  const [t, locale] = await Promise.all([getTranslations("inventory"), getLocale()]);
  const [rows, suppliers] = await Promise.all([reorderSuggestions(ctx), listSuppliers(ctx)]);
  const buy = can(ctx, "vendor.purchasing.manage");
  return (
    <>
      <PageHeader title={t("reorderPage")} description={t("reorderHint")} />
      {rows.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="no-reorder">{t("noReorder")}</p>
        : buy ? (
          <ReorderTable suppliers={suppliers.map((s) => ({ id: s.id, label: s.name }))}
            rows={rows.map((r) => ({ offerId: r.offer.id, addressId: r.addressId, label: offerLabel(r.offer.product, r.offer.packaging, r.offer.sku, locale), warehouse: r.warehouse, usable: r.usable, incoming: r.incoming, reorderPoint: r.reorderPoint!, suggestedQty: r.suggestedQty, supplier: r.supplier, lastCost: r.lastCost }))} />
        ) : (
          <Table>
            <THead><TR><TH>{t("product")}</TH><TH>{t("warehouse")}</TH><TH className="text-right">{t("free")}</TH><TH className="text-right">{t("reorderAt")}</TH><TH className="text-right">{t("suggested")}</TH><TH className="text-right">{t("lastCost")}</TH></TR></THead>
            <TBody>{rows.map((r) => <TR key={`${r.offer.id}-${r.addressId}`}><TD>{offerLabel(r.offer.product, r.offer.packaging, r.offer.sku, locale)}</TD><TD>{r.warehouse}</TD><TD className="text-right">{r.usable}</TD><TD className="text-right">{r.reorderPoint}</TD><TD className="text-right">{r.suggestedQty}</TD><TD className="text-right">{r.lastCost ? formatMoney(r.lastCost, locale) : "—"}</TD></TR>)}</TBody>
          </Table>
        )}
    </>
  );
}
