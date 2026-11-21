import { Globe2 } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { tradeSettingsPage } from "@/server/trade/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { TradeSettingsForm } from "@/components/trade/admin";

export const metadata = { title: "EU Trade Reporting Settings" };
export const dynamic = "force-dynamic";

export default async function EuTradeSettingsPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage", "admin.tax.manage"]);
  const d = await tradeSettingsPage(ctx);
  return (
    <>
      <PageHeader title="EU Trade Reporting" icon={Globe2} description="Which returns FIRINGI makes, the VIES check before invoicing without VAT, customs codes, corrections, reminders, and each country's deadlines, thresholds and file layout." />
      <Card><CardContent className="pt-5"><TradeSettingsForm initial={d.settings} countries={d.countries} /></CardContent></Card>
    </>
  );
}
