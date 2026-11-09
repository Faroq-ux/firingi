import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { BuyerSpendingReport } from "@/components/analytics/portal-views";

export async function generateMetadata() {
  return { title: (await getTranslations("reports"))("buyerTitle") };
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.reports.view");
  return <BuyerSpendingReport ctx={ctx} searchParams={await searchParams} />;
}
