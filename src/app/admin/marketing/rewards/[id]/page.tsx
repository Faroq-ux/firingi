import Link from "next/link";
import { Gift } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminReward, adminRedemptions, rewardsSettings } from "@/server/rewards/service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminRewardForm, PartnerCodes, ReviewButtons, RewardImage, RewardStatusButtons } from "@/components/rewards/admin";

export const metadata = { title: "Reward" };
export const dynamic = "force-dynamic";

/** Phase 55: one reward — edit, picture, partner codes, accept a supplier's reward, who redeemed it. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage"]);
  const { id } = await params;
  const [d, s, all] = await Promise.all([adminReward(ctx, id), rewardsSettings(), adminRedemptions(ctx, { rewardId: id })]);
  const it = d.item;
  const reds = all.slice(0, 20);
  return (
    <>
      <PageHeader title={it.title} icon={Gift} eyebrow={it.kind.replace("_", " ").toLowerCase()} description={it.supplier ? `Offered by ${it.supplier} — ${it.qty} × ${it.offer?.name ?? ""}, paid by the supplier.` : undefined}
        actions={<div className="flex flex-wrap items-center gap-2"><Badge variant={it.status === "ACTIVE" ? "success" : it.status === "PENDING" ? "warning" : "secondary"} data-testid="ar-status">{it.status.toLowerCase()}</Badge><RewardStatusButtons id={it.id} status={it.status} /><Link href="/admin/marketing/rewards" className="text-sm text-primary hover:underline">← Rewards Shop</Link></div>} />
      {it.status === "PENDING" && <Card className="mb-4 border-warning/50"><CardHeader><CardTitle>Supplier reward waiting for FIRINGI</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p>{it.points.toLocaleString("en")} points for {it.qty} × {it.offer?.name} · stock {it.stock}{it.description ? ` · “${it.description}”` : ""}</p><ReviewButtons id={it.id} /></CardContent></Card>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardContent className="pt-6">
          {it.kind === "SUPPLIER_PRODUCT" ? <p className="text-sm text-muted-foreground">The supplier sets this reward on its own page. {it.reviewNote && `Note: ${it.reviewNote}`}</p> : <AdminRewardForm initial={it} pointValue={d.pointValue} defaultDays={s.voucherDays} />}
        </CardContent></Card>
        <div className="space-y-4">
          {it.kind !== "SUPPLIER_PRODUCT" && <Card><CardHeader><CardTitle>Picture</CardTitle></CardHeader><CardContent><RewardImage id={it.id} image={it.image} /></CardContent></Card>}
          {it.kind === "PARTNER" && <Card><CardHeader><CardTitle>Codes</CardTitle></CardHeader><CardContent><PartnerCodes id={it.id} codes={d.codes} /></CardContent></Card>}
          {d.check && <Card><CardContent className="pt-5 text-sm">The points are worth <b>{d.check.worth.toFixed(2)} €</b> as a checkout discount; the voucher gives {it.voucherAmount?.toFixed(2)} €.{d.check.generous && " FIRINGI gives more than the points are worth."}</CardContent></Card>}
          <Card><CardHeader><CardTitle>Latest redemptions</CardTitle></CardHeader><CardContent>
            {!reds.length ? <p className="text-sm text-muted-foreground">None yet.</p> : <ul className="divide-y text-sm">{reds.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span className="break-words">{r.buyer}</span><span className="text-muted-foreground">{r.status.toLowerCase()} · {new Date(r.at).toLocaleDateString("en-GB")}</span></li>)}</ul>}
            <Link href="/admin/marketing/rewards/redemptions" className="mt-2 inline-block text-sm text-primary hover:underline">All redemptions →</Link>
          </CardContent></Card>
        </div>
      </div>
    </>
  );
}
