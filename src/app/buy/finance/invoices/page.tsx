import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { getTranslations } from "next-intl/server";
import { SalesInvoicesView } from "@/components/finance/views";

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.invoices.view"]);
  const t = await getTranslations("finance");
  return <SalesInvoicesView page={Number((await searchParams).page) || 1} basePath="/buy/finance/invoices" ctx={ctx} as="BUYER" title={t("invoices")} />;
}
