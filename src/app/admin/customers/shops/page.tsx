import { Store } from "lucide-react";
import { getLocale } from "next-intl/server";
import { createTranslator } from "next-intl";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminShops } from "@/server/multisite/branches";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";
import { formatMoney } from "@/lib/utils";
import en from "@/messages/en.json";

export const metadata = { title: "Customer Shops" };

export default async function CustomerShops() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.customers.view", "admin.customers.approve"]);
  const [rows, locale] = await Promise.all([adminShops(ctx), getLocale()]);
  const t = createTranslator({ locale: "en", messages: en, namespace: "onboarding" });
  const cat = (c: string | null) => (c ? t(`businessTypes.${c}` as "businessTypes.other") : "—");
  return (
    <>
      <PageHeader title="Customer Shops" icon={Store} description="Shops (branches) of customers and wholesalers — one company, several shops, each with its own address, category and staff. Orders, budgets and FIRINGI's invoices carry the shop and its cost centre." />
      <DataTable tableId="admin.customer-shops" testId="admin-shops" empty="No customer has added shops yet."
        columns={[{ key: "shop", label: "Shop" }, { key: "company", label: "Company", filter: true }, { key: "category", label: "Shop category", filter: true }, { key: "city", label: "City", filter: true }, { key: "staff", label: "Staff", type: "number" }, { key: "orders", label: "Orders this month", type: "number" }, { key: "spend", label: "Spend this month", type: "money" }, { key: "status", label: "Status", type: "badge", filter: true }]}
        rows={rows.map((r) => ({
          id: r.id, href: `/admin/companies/${r.companyId}`,
          cells: {
            shop: { t: r.name, sub: [r.code, r.address].filter(Boolean).join(" · ") || undefined }, company: { t: r.company, href: `/admin/companies/${r.companyId}`, sub: r.companyType === "WHOLESALER" ? "Wholesaler" : "Customer" },
            category: cat(r.category), city: r.city ?? "—", staff: r.staff, orders: r.monthOrders, spend: { t: formatMoney(r.monthSpend, locale), v: Number(r.monthSpend) },
            status: { t: r.isActive ? "Active" : "Inactive", tone: r.isActive ? "success" : "outline" },
          },
        }))} />
    </>
  );
}
