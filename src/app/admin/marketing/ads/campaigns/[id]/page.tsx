import { notFound } from "next/navigation";
import { Megaphone } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { campaignDetail } from "@/server/ads/service";
import { NotFoundError } from "@/server/errors";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { AdsTabs, StaffCampaignActions } from "@/components/ads/admin";
import { PLACEMENT_LABEL } from "@/components/ads/labels";
import { formatMoney } from "@/lib/utils";
import { STATUS } from "@/components/ads/labels";

export const metadata = { title: "Ad campaign" };
export const dynamic = "force-dynamic";

export default async function AdCampaign({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage", "admin.finance.view", "admin.finance.manage"]);
  const r = await campaignDetail(ctx, (await params).id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const c = r.campaign;
  const manage = ctx.permissions.has("admin.marketing.manage");
  const facts: [string, string][] = [
    ["Supplier", c.vendorName], ["Where", PLACEMENT_LABEL[c.placement]],
    ["Price", c.pricing === "CPC" ? `${formatMoney(c.cpcBid!.toString(), "en-GB")} per click · ${formatMoney(c.dailyBudget!.toString(), "en-GB")} a day${c.totalBudget ? ` · ${formatMoney(c.totalBudget.toString(), "en-GB")} in total` : ""}` : `${formatMoney(c.dailyPrice!.toString(), "en-GB")} per booked day`],
    ["Dates", `${c.startsOn.toISOString().slice(0, 10)} → ${c.endsOn ? c.endsOn.toISOString().slice(0, 10) : "open"}`],
    ...(c.keywords.length ? [["Search words", c.keywords.join(", ")] as [string, string]] : []),
    ...(c.categoryName ? [["Category", pickLocalized(c.categoryName, "en")] as [string, string]] : []),
    ...(c.rejectReason ? [["Rejected because", c.rejectReason] as [string, string]] : []),
  ];
  const kpis: [string, string][] = [["Impressions", r.totals.impressions.toLocaleString("en-GB")], ["Clicks", r.totals.clicks.toLocaleString("en-GB")], ["Click rate", `${(r.totals.ctr * 100).toFixed(1)} %`], ["Spent", formatMoney(r.totals.cost, "en-GB")], ["Orders after a click (7 days)", String(r.totals.orders)], ["Their value (supplier prices)", formatMoney(r.totals.revenue, "en-GB")]];
  return (
    <>
      <PageHeader title={c.name} icon={Megaphone} description="A supplier's sponsored-products campaign." actions={manage ? <StaffCampaignActions id={c.id} status={c.status} /> : undefined} />
      <AdsTabs active="/admin/marketing/ads/campaigns" />
      <div className="mb-4 flex flex-wrap items-center gap-2"><Badge variant={STATUS[c.status][1]} data-testid="campaign-status">{STATUS[c.status][0]}</Badge>{c.pausedReason && <span className="text-sm text-muted-foreground">({c.pausedReason.toLowerCase()})</span>}</div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Campaign</CardTitle></CardHeader><CardContent>
          <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5 text-sm">{facts.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>)}</dl>
          <h3 className="mb-1 mt-4 text-sm font-semibold">Products</h3>
          <ul className="text-sm">{r.offers.map((o) => <li key={o.id}>{pickLocalized(o.name, "en")} — {pickLocalized(o.pack, "en")} <span className="font-mono text-xs text-muted-foreground">{o.sku}</span>{o.status !== "ACTIVE" && <Badge variant="outline" className="ml-1">{o.status.toLowerCase()}</Badge>}</li>)}</ul>
        </CardContent></Card>
        <div className="grid grid-cols-2 gap-3" data-testid="campaign-kpis">
          {kpis.map(([l, v]) => <Card key={l}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{l}</p><p className="kpi-value text-xl font-semibold tabular-nums">{v}</p></CardContent></Card>)}
        </div>
      </div>
      <div className="mt-4">
        <DataTable tableId="admin.ads.days" testId="days-table" empty="No impressions yet."
          columns={[{ key: "day", label: "Day", type: "date" }, { key: "impressions", label: "Impressions", type: "number" }, { key: "clicks", label: "Clicks", type: "number" }, { key: "cost", label: "Cost", type: "number" }]}
          rows={r.days.map((d) => ({ id: d.day, cells: { day: d.day, impressions: d.impressions, clicks: d.clicks, cost: { t: formatMoney(d.cost, "en-GB"), v: Number(d.cost) } } }))} />
      </div>
    </>
  );
}
