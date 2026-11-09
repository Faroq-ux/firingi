import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { DriverList } from "@/components/delivery/driver-views";

export const metadata = { title: "History" };

export default async function Page() {
  const ctx = await pagePortal("driver");
  pagePermission(ctx, "driver.deliveries.view");
  const t = await getTranslations("delivery");
  return (
    <>
      <PageHeader title={t("history")} />
      <DriverList ctx={ctx} period="HISTORY" />
    </>
  );
}
