import { SlidersHorizontal } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { canManagePricing, priceSettings } from "@/server/price-intel/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { PriceSettingsForm } from "@/components/price-intel/admin";

export const metadata = { title: "Price Rules & Approvals" };

export default async function PriceRules() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.view", "admin.pricing.manage"]);
  const s = await priceSettings();
  return (
    <>
      <PageHeader title="Price Rules & Approvals" icon={SlidersHorizontal} description="When a supplier's increase needs FIRINGI's approval, how far ahead customers are told, and when FIRINGI is alerted about a price." />
      <Card><CardContent className="pt-5">{canManagePricing(ctx) ? <PriceSettingsForm initial={s} /> : <pre className="text-sm">{JSON.stringify(s, null, 2)}</pre>}</CardContent></Card>
    </>
  );
}
