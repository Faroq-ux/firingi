import { Star } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { MyReviewsView } from "@/components/reviews/views";
import { reviewLabels } from "@/components/reviews/labels";

export const metadata = { title: "My Reviews" };
export const dynamic = "force-dynamic";

/** Phase 53: products to review, the business's reviews and questions. */
export default async function Page() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.reviews.write", "buyer.orders.view"]);
  const { l } = await reviewLabels();
  return (
    <>
      <PageHeader title={l.myTitle} icon={Star} description={l.myIntro} />
      <MyReviewsView ctx={ctx} />
    </>
  );
}
