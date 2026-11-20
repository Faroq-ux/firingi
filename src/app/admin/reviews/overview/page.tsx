import Link from "next/link";
import { Star } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminReviewOverview } from "@/server/reviews/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Stars } from "@/components/reviews/stars";

export const metadata = { title: "Reviews Overview" };
export const dynamic = "force-dynamic";

/** Phase 53: how many reviews and questions, the average rating, the best and worst rated products. */
export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.reviews.moderate", "admin.settings.manage"]);
  const o = await adminReviewOverview(ctx);
  const tile = (label: string, value: string, href?: string) => <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-semibold tabular-nums">{href ? <Link href={href} className="hover:text-primary">{value}</Link> : value}</p></CardContent></Card>;
  const list = (rows: typeof o.best) => rows.length === 0 ? <p className="text-sm text-muted-foreground">No ratings yet.</p> : (
    <ul className="divide-y text-sm">{rows.map((r) => <li key={`${r.productId}:${r.supplier}`} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1 break-words"><b>{r.product}</b> <span className="text-xs text-muted-foreground">· {r.supplier}</span></span><span className="flex items-center gap-1 tabular-nums"><Stars value={r.avg} size={12} /> {r.avg.toFixed(1)} ({r.count})</span></li>)}</ul>
  );
  return (
    <>
      <PageHeader title="Reviews Overview" icon={Star} description="Product reviews and questions across the marketplace. Supplier names are shown to FIRINGI only." actions={<div className="flex gap-3 text-sm"><Link href="/admin/reviews" className="text-primary hover:underline">Moderation →</Link><Link href="/admin/settings/reviews" className="text-primary hover:underline">Settings →</Link></div>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="reviews-overview">
        {tile("Published reviews", String(o.total))}
        {tile("Average rating", o.avg == null ? "—" : `${o.avg.toFixed(2)} ★`)}
        {tile("Reviews, last 30 days", String(o.last30))}
        {tile("Questions (unanswered)", `${o.questions} (${o.unanswered})`)}
        {tile("Waiting for FIRINGI", String(o.held), "/admin/reviews?tab=HELD")}
        {tile("Open reports", String(o.reported), "/admin/reviews?tab=REPORTED")}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Lowest rated</CardTitle></CardHeader><CardContent>{list(o.worst)}</CardContent></Card>
        <Card><CardHeader><CardTitle>Highest rated</CardTitle></CardHeader><CardContent>{list(o.best)}</CardContent></Card>
      </div>
    </>
  );
}
