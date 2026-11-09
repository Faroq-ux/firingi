import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { DocumentsSection } from "@/components/company/sections";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "company.documents.manage");
  const t = await getTranslations("onboarding");
  return (
    <>
      <PageHeader title={t("hub.documents")} />
      <Card><CardContent className="pt-5"><DocumentsSection ctx={ctx} /></CardContent></Card>
    </>
  );
}
