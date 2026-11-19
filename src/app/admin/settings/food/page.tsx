import { Apple } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { foodSettings } from "@/server/food/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { FoodSettingsForm } from "@/components/food/client";

export const metadata = { title: "Food Information" };
export const dynamic = "force-dynamic";

export default async function FoodSettingsPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage"]);
  return (
    <>
      <PageHeader title="Food Information & Allergens" icon={Apple} description="EU 1169/2011 food information: what suppliers fill in, whether FIRINGI checks it, whether it is required to sell, and what customers and resellers get — each switch on or off." />
      <Card><CardContent className="pt-5"><FoodSettingsForm initial={await foodSettings()} /></CardContent></Card>
    </>
  );
}
