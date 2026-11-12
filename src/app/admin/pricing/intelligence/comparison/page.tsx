import { Scale } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { priceComparison } from "@/server/price-intel/service";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Price Comparison" };
const eur = (v: number) => formatMoney(v < 1 ? v.toFixed(4) : v.toFixed(2), "en");

export default async function PriceComparisonPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.view", "admin.pricing.manage"]);
  const rows = await priceComparison(ctx);
  return (
    <>
      <PageHeader title="Price Comparison" icon={Scale} description="Products sold by two or more suppliers — base price per unit (a 12-pack counts as 12 units), compared within the same market: wholesalers per country, distributors EU-wide. Sorted by spread (cheapest → dearest)." />
      <DataTable tableId="admin.price.comparison" testId="comparison" empty="No product is sold by two or more suppliers yet."
        columns={[{ key: "product", label: "Product" }, { key: "market", label: "Market", type: "badge", filter: true }, { key: "n", label: "Suppliers", type: "number" }, { key: "min", label: "Cheapest / unit", type: "money" }, { key: "median", label: "Median / unit", type: "money" }, { key: "max", label: "Dearest / unit", type: "money" }, { key: "spread", label: "Spread", type: "number" }, { key: "cheapest", label: "Cheapest supplier", filter: true }, { key: "dearest", label: "Dearest supplier", hidden: true }]}
        rows={rows.map((r) => ({
          id: r.key, href: `/admin/pricing/intelligence/history?variant=${r.variantId}`,
          cells: {
            product: { t: r.product, sub: r.sku, href: `/admin/pricing/intelligence/history?variant=${r.variantId}` },
            market: { t: `${r.sellerType === "WHOLESALER" ? "Wholesale" : "Distribution"} · ${r.market}`, tone: r.sellerType === "WHOLESALER" ? "default" : "outline" },
            n: r.stats.n, min: { t: eur(r.stats.min), v: r.stats.min }, median: { t: eur(r.stats.median), v: r.stats.median }, max: { t: eur(r.stats.max), v: r.stats.max },
            spread: { t: `${r.stats.spreadPct.toFixed(0)} %`, v: r.stats.spreadPct, tone: r.stats.spreadPct >= 30 ? "warning" : undefined },
            cheapest: { t: r.cheapest.vendor, sub: eur(r.cheapest.unitPrice) }, dearest: { t: r.dearest.vendor, sub: eur(r.dearest.unitPrice) },
          },
        }))} />
    </>
  );
}
