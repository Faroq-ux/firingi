import { Scale } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { catchWeightSettings, settingsCountries } from "@/server/catchweight/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { SettingsForm } from "@/components/catchweight/client";

export const metadata = { title: "Sold by Weight" };
export const dynamic = "force-dynamic";

export default async function CatchWeightSettingsPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage"]);
  const [s, countries] = await Promise.all([catchWeightSettings(), settingsCountries(ctx)]);
  return (
    <>
      <PageHeader title="Sold by Weight" icon={Scale} description="Meat, fish, cheese… priced per kg and billed on the real weight. The over-weight limit per country, the buffer paid in advance by pay-before-shipping customers, driver corrections, weighing before dispatch and the scale-label format." />
      <Card><CardContent className="pt-5"><SettingsForm initial={s} countries={countries} /></CardContent></Card>
    </>
  );
}
