import { ChartNoAxesCombined } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { VendorInsightsView } from "@/components/reviews/views";
import { reviewLabels } from "@/components/reviews/labels";

export const metadata = { title: "Review Insights" };
export const dynamic = "force-dynamic";

/** Phase 53: ratings per product, the 12-month trend and the most common complaints. */
export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.reviews.manage");
  const { l } = await reviewLabels();
  return (
    <>
      <PageHeader title={l.insTitle} icon={ChartNoAxesCombined} description={l.insIntro} />
      <VendorInsightsView ctx={ctx} />
    </>
  );
}
