import { Wine } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { exciseSettings } from "@/server/excise/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ExciseSettingsForm } from "@/components/excise/client";

export const metadata = { title: "Licensed Goods" };
export const dynamic = "force-dynamic";

export default async function ExciseSettingsPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage"]);
  return (
    <>
      <PageHeader title="Licensed & Excise Goods" icon={Wine} description="Alcohol, tobacco, vaping and sugary drinks: which goods count, customer and supplier licences, how duty is shown or added, restrictions and records — each switch on or off." />
      <Card><CardContent className="pt-5"><ExciseSettingsForm initial={await exciseSettings()} /></CardContent></Card>
    </>
  );
}
