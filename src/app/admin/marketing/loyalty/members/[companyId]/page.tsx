import Link from "next/link";
import { Gift } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { loyaltySettings, memberDetail } from "@/server/loyalty/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { LoyaltyTabs } from "@/components/loyalty/admin-tabs";
import { AdjustForm } from "@/components/loyalty/admin";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Loyalty member" };
const KIND: Record<string, string> = {
  EARN: "Delivered order", REFERRAL: "Referral bonus", BONUS: "Bonus from FIRINGI", ADJUST: "Correction by FIRINGI", REDEEM_ORDER: "Used on an order",
  REDEEM_CREDIT: "Turned into a credit note", REFUND: "Given back (order cancelled)", REVERSE: "Taken back (goods credited)", EXPIRE: "Expired",
};

export default async function Member({ params }: { params: Promise<{ companyId: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage"]);
  const { companyId } = await params;
  const [a, s] = await Promise.all([memberDetail(ctx, companyId), loyaltySettings()]);
  const name = a.company.tradeName ?? a.company.legalName;
  return (
    <>
      <PageHeader title={name} icon={Gift} description={`${a.company.type === "CUSTOMER" ? "Customer" : "Wholesaler"} · ${a.tier[0]}${a.tier.slice(1).toLowerCase()} · code ${a.referralCode}`} />
      <LoyaltyTabs active="/admin/marketing/loyalty/members" />
      <div className="grid gap-3 sm:grid-cols-3" data-testid="member-kpis">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Points</p><p className="kpi-value text-2xl font-semibold" data-testid="member-balance">{a.balance.toLocaleString("en-GB")}</p><p className="text-xs text-muted-foreground">= {formatMoney(a.balance * s.pointValue, "en-GB")}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Earned in total</p><p className="kpi-value text-2xl font-semibold">{a.lifetimeEarned.toLocaleString("en-GB")}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Spend in the last 12 months</p><p className="kpi-value text-2xl font-semibold">{formatMoney(a.spend12m.toString(), "en-GB")}</p></CardContent></Card>
      </div>
      {ctx.permissions.has("admin.marketing.manage") && (
        <Card className="mt-4"><CardHeader><CardTitle>Give or take points</CardTitle></CardHeader><CardContent><AdjustForm companyId={companyId} /></CardContent></Card>
      )}
      <div className="mt-4">
        <DataTable tableId="admin.loyalty.ledger" testId="ledger-table" empty="No points yet."
          columns={[{ key: "date", label: "Date", type: "date" }, { key: "kind", label: "What", filter: true }, { key: "points", label: "Points", type: "number" }, { key: "left", label: "Not yet used", type: "number" }, { key: "expires", label: "Expires" }, { key: "note", label: "Note" }]}
          rows={a.entries.map((e) => ({
            id: e.id,
            cells: {
              date: { t: formatDate(e.createdAt, "en-GB", true), v: e.createdAt.getTime() }, kind: KIND[e.kind] ?? e.kind, points: e.points, left: e.points > 0 ? e.remaining : "",
              expires: e.points > 0 && e.expiresAt ? formatDate(e.expiresAt, "en-GB") : "",
              note: e.orderId ? { t: e.note ?? "", node: <Link href={`/admin/orders/${e.orderId}`} className="text-primary hover:underline">{e.note ?? "Order"}</Link> } : e.note ?? "",
            },
          }))} />
      </div>
    </>
  );
}
