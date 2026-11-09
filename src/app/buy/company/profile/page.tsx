import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { ProfileSection } from "@/components/company/sections";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default async function Page() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "company.profile.manage");
  const t = await getTranslations("onboarding");
  return (
    <>
      <PageHeader title={t("hub.profile")} />
      <Card><CardContent className="pt-5"><ProfileSection ctx={ctx} /></CardContent></Card>
    </>
  );
}
