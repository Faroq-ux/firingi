import { MessageCircleQuestion } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { VendorQuestionsView } from "@/components/reviews/views";
import { reviewLabels } from "@/components/reviews/labels";

export const metadata = { title: "Product Questions" };
export const dynamic = "force-dynamic";

/** Phase 53: buyers' questions about the supplier's products — answers show as official. */
export default async function Page({ searchParams }: { searchParams: Promise<{ all?: string; page?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.reviews.manage");
  const sp = await searchParams;
  const { l } = await reviewLabels();
  return (
    <>
      <PageHeader title={l.vqTitle} icon={MessageCircleQuestion} description={l.vqIntro} />
      <VendorQuestionsView ctx={ctx} open={sp.all !== "1"} page={Number(sp.page) || 1} />
    </>
  );
}
