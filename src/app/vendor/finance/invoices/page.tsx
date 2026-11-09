import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { getTranslations } from "next-intl/server";
import { VendorInvoicesView } from "@/components/finance/views";

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.invoices.view", "vendor.invoices.submit"]);
  const t = await getTranslations("finance");
  return <VendorInvoicesView ctx={ctx} as="VENDOR" title={t("myInvoices")} />;
}
