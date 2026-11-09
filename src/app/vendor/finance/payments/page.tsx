import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { getTranslations } from "next-intl/server";
import { PaymentsView } from "@/components/finance/views";

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.payments.view"]);
  const t = await getTranslations("finance");
  return <PaymentsView ctx={ctx} as="VENDOR" title={t("payments")} />;
}
