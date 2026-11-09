import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { RestrictedSection } from "@/components/company/sections";
import { PageHeader } from "@/components/layout/page-header";

export default async function Page() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.compliance.manage");
  const t = await getTranslations("onboarding.restricted");
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />
      <RestrictedSection ctx={ctx} />
    </>
  );
}
