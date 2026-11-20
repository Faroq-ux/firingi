import Link from "next/link";
import { Gift } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { rewardsSettings } from "@/server/rewards/service";
import { loyaltySettings } from "@/server/loyalty/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { AdminRewardForm } from "@/components/rewards/admin";
import { REWARD_KINDS, type RewardKindT } from "@/lib/rewards";

export const metadata = { title: "New Reward" };
export const dynamic = "force-dynamic";

/** Phase 55: FIRINGI adds a voucher, free delivery, gift or partner offer. */
export default async function Page({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, "admin.marketing.manage");
  const { kind } = await searchParams;
  const k = ((REWARD_KINDS as readonly string[]).includes(kind ?? "") && kind !== "SUPPLIER_PRODUCT" ? kind : "VOUCHER") as RewardKindT;
  const [s, ls] = await Promise.all([rewardsSettings(), loyaltySettings()]);
  return (
    <>
      <PageHeader title="New Reward" icon={Gift} actions={<Link href="/admin/marketing/rewards" className="text-sm text-primary hover:underline">← Rewards Shop</Link>} />
      <Card><CardContent className="pt-6"><AdminRewardForm kind={k} pointValue={ls.pointValue} defaultDays={s.voucherDays} /></CardContent></Card>
    </>
  );
}
