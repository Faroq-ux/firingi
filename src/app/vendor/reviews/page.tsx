import Link from "next/link";
import { Star } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { VendorReviewsView } from "@/components/reviews/views";
import { reviewLabels } from "@/components/reviews/labels";

export const metadata = { title: "Reviews" };
export const dynamic = "force-dynamic";

/** Phase 53: what buyers say about the supplier's products; one public reply each. */
export default async function Page({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string; product?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.reviews.manage");
  const sp = await searchParams;
  const { l } = await reviewLabels();
  return (
    <>
      <PageHeader title={l.vTitle} icon={Star} description={l.vIntro} actions={<div className="flex flex-wrap gap-3 text-sm"><Link href="/vendor/reviews/questions" className="text-primary hover:underline">{l.vqTitle} →</Link><Link href="/vendor/reviews/insights" className="text-primary hover:underline">{l.insTitle} →</Link></div>} />
      <VendorReviewsView ctx={ctx} filter={sp.filter} page={Number(sp.page) || 1} productId={sp.product ?? null} />
    </>
  );
}
