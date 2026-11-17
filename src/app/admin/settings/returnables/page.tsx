import { Recycle } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { returnableSettings, settingsFormData } from "@/server/returnables/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { SettingsForm } from "@/components/returnables/client";

export const metadata = { title: "Returnables & Deposits" };
export const dynamic = "force-dynamic";

export default async function ReturnablesSettingsPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage"]);
  const [s, f] = await Promise.all([returnableSettings(), settingsFormData(ctx)]);
  return (
    <>
      <PageHeader title="Returnables & Deposits" icon={Recycle} description="VAT on deposits per country, what happens to empties kept too long (per supplier if needed), refunds for damaged empties, and pickups." />
      <Card><CardContent className="pt-5"><SettingsForm initial={s} countries={f.countries} suppliers={f.suppliers} /></CardContent></Card>
    </>
  );
}
