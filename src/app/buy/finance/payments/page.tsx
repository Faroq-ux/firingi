import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { getTranslations } from "next-intl/server";
import { PaymentsView } from "@/components/finance/views";
import { BuyerPaymentsInProgress } from "@/components/payments/buyer-cards";

export default async function Page() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.payments.view", "buyer.invoices.view"]);
  const t = await getTranslations("finance");
  return <PaymentsView ctx={ctx} as="BUYER" title={t("payments")} before={<BuyerPaymentsInProgress ctx={ctx} />} />;
}
