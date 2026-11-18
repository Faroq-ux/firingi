import { Thermometer } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { coldChainSettings } from "@/server/coldchain/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { SettingsForm } from "@/components/coldchain/client";

export const metadata = { title: "Cold Chain" };
export const dynamic = "force-dynamic";

export default async function ColdChainSettingsPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage"]);
  return (
    <>
      <PageHeader title="Cold Chain & HACCP" icon={Thermometer} description="Switch each way of recording temperatures, each reaction to an out-of-range reading and each HACCP record on or off." />
      <Card><CardContent className="pt-5"><SettingsForm initial={await coldChainSettings()} /></CardContent></Card>
    </>
  );
}
