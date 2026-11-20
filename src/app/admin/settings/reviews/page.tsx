import Link from "next/link";
import { Star } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { aiSummaryStatus, reviewSettings, reviewSwitches } from "@/server/reviews/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FindReviewBusiness, ReviewSettingsForm, ReviewSwitch } from "@/components/reviews/admin";

export const metadata = { title: "Reviews Settings" };
export const dynamic = "force-dynamic";

/** Phase 53: every reviews & questions switch, the automatic filter, per-business switches. */
export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, "admin.settings.manage");
  const [s, sw, ai] = await Promise.all([reviewSettings(), reviewSwitches(ctx), aiSummaryStatus()]);
  return (
    <>
      <PageHeader title="Reviews & Questions" icon={Star} description="Verified buyers review what they received; suppliers reply once; questions are answered by the supplier, FIRINGI and buyers who bought it. Switch every part on or off, per business type and per business." actions={<Link href="/admin/reviews" className="text-sm text-primary hover:underline">Moderation →</Link>} />
      {!ai.configured && <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="ai-not-configured">The AI summary needs the Anthropic key (AI Centre). Without it, no summary is shown.</p>}
      <Card className="mb-6"><CardContent className="pt-6"><ReviewSettingsForm initial={s} /></CardContent></Card>
      <Card>
        <CardHeader><CardTitle>Businesses</CardTitle><CardDescription>Default follows the types above. A buyer switched off can&apos;t write, ask or answer; a supplier switched off has no reviews shown on its products.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {sw.length > 0 && <ul className="divide-y" data-testid="review-switches">{sw.map((x) => <li key={x.companyId} className="flex flex-wrap items-center gap-2 py-2 text-sm"><span className="min-w-0 flex-1 break-words">{x.name} <span className="text-xs text-muted-foreground">· {x.type.toLowerCase()}</span></span><ReviewSwitch companyId={x.companyId} state={x.state} /></li>)}</ul>}
          <FindReviewBusiness />
        </CardContent>
      </Card>
    </>
  );
}
