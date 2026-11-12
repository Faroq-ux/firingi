import { PackagePlus } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { myLeadTimes, mySuggestions } from "@/server/planning/service";
import { rowLabel } from "@/server/planning/engine";
import { isoDay } from "@/server/planning/model";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { RecalcButton, RestockTable, type SourceOpt } from "@/components/planning/vendor";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Restock" };
const B = "/vendor/inventory/planning";

export default async function Restock() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.purchasing.manage"]);
  const [open, done, leads, t, locale] = await Promise.all([mySuggestions(ctx), mySuggestions(ctx, "DONE"), myLeadTimes(ctx), getTranslations("planning"), getLocale()]);
  const sources: SourceOpt[] = leads.filter((s) => s.kind === "OUTSIDE" && s.active).map((s) => ({ key: `S:${s.id}`, label: t("sourceLabel", { name: s.name, days: s.days }), kind: "OUTSIDE", id: s.id }));
  const nameOf = (id: string) => leads.find((s) => s.id === id)?.name ?? "—";
  const label = (s: (typeof open)[number]) => rowLabel({ product: s.offer.packaging.variant.product.name, packaging: s.offer.packaging.name, sku: s.offer.vendorSku }, locale);
  const canOrder = can(ctx, "vendor.purchasing.manage");
  return (
    <>
      <PageHeader title={t("restockTitle")} description={t("restockIntro")} icon={PackagePlus} actions={can(ctx, ["vendor.purchasing.manage", "vendor.inventory.manage"]) ? <RecalcButton /> : undefined} />
      {(
        <RestockTable canOrder={canOrder} sources={sources} locale={locale} empty={t("nothingToOrder")}
          rows={open.map((s) => ({
            id: s.id, label: label(s), href: `${B}/forecast/${s.offerId}?w=${s.addressId}`, warehouse: s.address.label, urgency: s.urgency, qty: s.qty, usable: s.usable, incoming: s.incoming,
            reorderPoint: s.reorderPoint, orderUpTo: s.orderUpTo, safetyStock: s.safetyStock, leadTimeDays: s.leadTimeDays, dailyDemand: s.dailyDemand,
            runsOutOn: s.runsOutOn ? isoDay(s.runsOutOn) : null, orderBy: s.orderBy ? isoDay(s.orderBy) : null,
            source: s.supplierId ? `S:${s.supplierId}` : s.sellerCompanyId ? `F:${s.sellerCompanyId}` : "", unitCost: s.unitCost?.toString() ?? "",
            extraSource: s.sellerCompanyId ? { key: `F:${s.sellerCompanyId}`, label: `${nameOf(s.sellerCompanyId)} (FIRINGI)`, kind: "FIRINGI", id: s.sellerCompanyId, sourceOfferId: s.sourceOfferId } : null,
          }))} />
      )}
      <Card className="mt-8">
        <CardHeader><CardTitle>{t("decidedTitle")}</CardTitle><CardDescription>{t("decidedHint")}</CardDescription></CardHeader>
        <CardContent>
          <DataTable tableId="vendor.planning.decided" testId="decided" empty={t("decidedEmpty")}
            columns={[{ key: "at", label: t("col.when"), type: "date" }, { key: "product", label: t("col.product") }, { key: "status", label: t("col.status"), type: "badge", filter: true }, { key: "qty", label: t("qty"), type: "number" }, { key: "note", label: t("col.note") }]}
            rows={done.map((s) => ({
              id: s.id, href: s.poId ? `/vendor/inventory/purchase-orders/${s.poId}` : undefined,
              cells: {
                at: { t: formatDate(s.decidedAt ?? s.updatedAt, locale), v: (s.decidedAt ?? s.updatedAt).getTime() }, product: { t: label(s), sub: s.address.label },
                status: { t: t(`status.${s.status}`), tone: s.status === "ORDERED" ? "success" : "outline" }, qty: s.qty,
                note: s.status === "DISMISSED" ? [s.dismissReason, s.snoozeUntil ? t("until", { date: formatDate(s.snoozeUntil, locale) }) : null].filter(Boolean).join(" · ") : "",
              },
            }))} />
        </CardContent>
      </Card>
    </>
  );
}
