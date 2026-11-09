import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { DriverList } from "@/components/delivery/driver-views";
import { AvailabilitySwitch } from "@/components/delivery/delivery-forms";
import { myAvailability } from "@/server/services/fleet";

export const metadata = { title: "Today's deliveries" };

export default async function Page() {
  const ctx = await pagePortal("driver");
  pagePermission(ctx, "driver.deliveries.view");
  const [t, availability] = await Promise.all([getTranslations("delivery"), myAvailability(ctx)]);
  return (
    <>
      <PageHeader title={t("today")} description={<span className="flex flex-wrap items-center gap-2">{t("myStatus")}: <AvailabilitySwitch current={availability} /></span>} />
      <DriverList ctx={ctx} period="TODAY" />
    </>
  );
}
