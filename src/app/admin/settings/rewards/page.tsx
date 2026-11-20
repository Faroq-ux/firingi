import Link from "next/link";
import { Gift } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { rewardsSettings, rewardsSwitches } from "@/server/rewards/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FindRewardsBusiness, RewardsSettingsForm, RewardsSwitch } from "@/components/rewards/admin";

export const metadata = { title: "Rewards Shop Settings" };
export const dynamic = "force-dynamic";

/** Phase 55: every rewards-shop switch, the rules and per-business switches. */
export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, "admin.marketing.manage");
  const [s, sw] = await Promise.all([rewardsSettings(), rewardsSwitches(ctx)]);
  return (
    <>
      <PageHeader title="Rewards Shop" icon={Gift} description="Switch the shop and each kind of reward on or off, choose who redeems and which suppliers may offer their products, and set the rules." actions={<Link href="/admin/marketing/rewards" className="text-sm text-primary hover:underline">Rewards Shop →</Link>} />
      <Card className="mb-6"><CardContent className="pt-6"><RewardsSettingsForm initial={s} /></CardContent></Card>
      <Card>
        <CardHeader><CardTitle>Businesses</CardTitle><CardDescription>Default follows the types above; switch one business on or off on its own (buyers: redeeming; suppliers: offering products).</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {sw.length > 0 && <ul className="divide-y" data-testid="rewards-switches">{sw.map((x) => <li key={x.companyId} className="flex flex-wrap items-center gap-2 py-2 text-sm"><span className="min-w-0 flex-1 break-words">{x.name} <span className="text-xs text-muted-foreground">· {x.type.toLowerCase()}</span></span><RewardsSwitch companyId={x.companyId} state={x.state} /></li>)}</ul>}
          <FindRewardsBusiness />
        </CardContent>
      </Card>
    </>
  );
}
