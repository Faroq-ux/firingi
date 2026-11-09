import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { AddressesSection } from "@/components/company/sections";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default async function Page() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["company.addresses.manage", "buyer.addresses.manage"]);
  const t = await getTranslations("onboarding");
  return (
    <>
      <PageHeader title={t("hub.addresses")} />
      <Card><CardContent className="pt-5"><AddressesSection ctx={ctx} kinds={["DELIVERY", "BILLING", "HEAD_OFFICE"]} /></CardContent></Card>
    </>
  );
}
