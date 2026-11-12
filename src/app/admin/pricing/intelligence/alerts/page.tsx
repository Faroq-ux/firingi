import { BellRing } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { canManagePricing, listAlerts, priceSettings } from "@/server/price-intel/service";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";
import { AlertActions, RunPricingCheck } from "@/components/price-intel/admin";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Price Alerts" };
const KIND = { JUMP: { t: "Price jump", tone: "warning" }, ABOVE_MARKET: { t: "Above market", tone: "destructive" }, BELOW_MARKET: { t: "Below market", tone: "default" } } as const;

export default async function PriceAlerts({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.view", "admin.pricing.manage"]);
  const all = (await searchParams).all === "1";
  const [rows, s] = await Promise.all([listAlerts(ctx, all ? "ALL" : "OPEN"), priceSettings()]);
  const manage = canManagePricing(ctx);
  return (
    <>
      <PageHeader title="Price Alerts" icon={BellRing}
        description={`Checked every hour: a base price up ${s.jumpPct} % or more within ${s.jumpWindowDays} days, or ${s.outlierPct} % above / below the median of the same product (markets with ${s.minSuppliers}+ suppliers). Alerts close by themselves when the price is back in line; a dismissed alert stays dismissed while the price doesn't change.`}
        actions={<><a href={all ? "?" : "?all=1"} className="text-sm text-primary hover:underline">{all ? "Open only" : "Show all"}</a>{manage && <RunPricingCheck />}</>} />
      <DataTable tableId="admin.price.alerts" testId="price-alerts" empty="No open price alerts."
        columns={[{ key: "kind", label: "Alert", type: "badge", filter: true }, { key: "product", label: "Product" }, { key: "vendor", label: "Supplier", filter: true }, { key: "price", label: "Price / unit", type: "money" }, { key: "ref", label: "Reference", type: "money" }, { key: "dev", label: "Deviation", type: "number" }, { key: "seen", label: "Since", type: "date" }, { key: "status", label: "Status", type: "badge", filter: true }, { key: "act", label: "" }]}
        rows={rows.map((a) => ({
          id: a.id, href: `/admin/pricing/intelligence/history?variant=${a.variantId}`,
          cells: {
            kind: KIND[a.kind], product: { t: a.product, sub: `${a.packaging} · ${a.sku}`, href: `/admin/pricing/intelligence/history?variant=${a.variantId}` }, vendor: a.vendorName,
            price: { t: formatMoney(a.unitPrice.toString(), "en"), v: Number(a.unitPrice) },
            ref: { t: `${formatMoney(a.reference.toString(), "en")} ${a.kind === "JUMP" ? "before" : "median"}`, v: Number(a.reference) },
            dev: { t: `${Number(a.deviationPct) > 0 ? "+" : ""}${Number(a.deviationPct).toFixed(0)} %`, v: Number(a.deviationPct) },
            seen: { t: formatDate(a.firstSeenAt, "en", true), v: a.firstSeenAt.getTime() }, status: { t: a.status.toLowerCase(), tone: a.status === "OPEN" ? "warning" : "outline" },
            act: { t: "", node: manage && (a.status === "OPEN" || a.status === "ACKNOWLEDGED") ? <AlertActions id={a.id} offerId={a.offerId} status={a.status} /> : null },
          },
        }))} />
    </>
  );
}
