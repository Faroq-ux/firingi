import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { VendorSalesReport } from "@/components/analytics/portal-views";

export async function generateMetadata() {
  return { title: (await getTranslations("reports"))("vendorTitle") };
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.reports.view");
  return <VendorSalesReport ctx={ctx} searchParams={await searchParams} />;
}
