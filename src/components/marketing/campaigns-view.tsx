/** Campaign list with results; `channel` narrows it (Email Campaigns, Push Notifications pages). */
import Link from "next/link";
import type { NotificationChannel } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { listCampaigns } from "@/server/marketing/campaigns";
import { marketingOptions } from "@/server/marketing/admin";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { CampaignBuilder, CHANNEL_INFO } from "./campaign-forms";
import { formatDate, formatMoney } from "@/lib/utils";

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "—");
export const STATUS_TONE: Record<string, "success" | "warning" | "secondary" | "default" | "destructive"> = { DRAFT: "secondary", SCHEDULED: "warning", SENDING: "default", SENT: "success", CANCELLED: "destructive" };

export async function CampaignsView({ ctx, channel, title, description, extra }: { ctx: Ctx; channel?: NotificationChannel; title: string; description: string; extra?: React.ReactNode }) {
  const manage = can(ctx, "admin.marketing.manage");
  const [all, opts] = await Promise.all([listCampaigns(ctx), marketingOptions(ctx)]);
  const rows = channel ? all.filter((c) => c.channels.includes(channel)) : all;
  const sent = rows.filter((r) => r.status === "SENT");
  const t = sent.reduce((a, r) => ({ sent: a.sent + r.stats.sent, opened: a.opened + r.stats.opened, clicked: a.clicked + r.stats.clicked, orders: a.orders + r.stats.orders, revenue: a.revenue + r.stats.revenue }), { sent: 0, opened: 0, clicked: 0, orders: 0, revenue: 0 });
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="campaign-kpis">
        <Kpi label="Campaigns sent" value={sent.length} fmt="number" locale="en" index={0} />
        <Kpi label="Messages delivered" value={t.sent} fmt="number" locale="en" index={1} />
        <Kpi label="Clicked" value={t.clicked} fmt="number" locale="en" hint={`${pct(t.clicked, t.sent)} of delivered · opened ${t.opened}`} index={2} />
        <Kpi label="Orders from campaigns" value={t.orders} fmt="number" locale="en" index={3} />
        <Kpi label="Goods sold (net)" value={t.revenue} fmt="money" locale="en" index={4} />
      </div>
      {extra}
      {manage && <div className="mb-4"><CampaignBuilder defaults={channel ? { channels: [channel] } : undefined} segments={opts.segments} buyers={opts.buyers} countries={opts.countries} promotions={opts.promotions} /></div>}
      <Card>
        <CardContent className="pt-5">
          <Table data-testid="campaigns-table">
            <THead><TR><TH>Campaign</TH><TH>Channels</TH><TH>Audience</TH><TH>Status</TH><TH className="text-right">Delivered</TH><TH className="text-right">Opened</TH><TH className="text-right">Clicked</TH><TH className="text-right">Orders</TH><TH className="text-right">Goods sold</TH></TR></THead>
            <TBody>
              {rows.map((c) => {
                const a = c.audience as { segmentId?: string; types?: string[]; countryCodes?: string[]; companyIds?: string[] };
                return (
                  <TR key={c.id}>
                    <TD><Link href={`/admin/marketing/campaigns/${c.id}`} className="font-medium text-primary hover:underline">{c.name}</Link>{c.promotion && <div className="text-xs text-muted-foreground">offer: {c.promotion.code ?? (c.promotion.name as { en?: string }).en}</div>}</TD>
                    <TD><div className="flex gap-1">{c.channels.map((ch) => { const I = CHANNEL_INFO[ch as keyof typeof CHANNEL_INFO].icon; return <I key={ch} className="size-4 text-[color:var(--vivid-violet)]" aria-label={ch} />; })}</div></TD>
                    <TD className="text-xs">{c.segment ? `Segment: ${c.segment.name}` : a.companyIds?.length ? `${a.companyIds.length} companies` : `${(a.types ?? ["CUSTOMER", "WHOLESALER"]).map((x) => x.toLowerCase()).join(", ")}${a.countryCodes?.length ? ` · ${a.countryCodes.join(", ")}` : ""}`}</TD>
                    <TD><Badge variant={STATUS_TONE[c.status]}>{c.status.toLowerCase()}</Badge><div className="text-xs text-muted-foreground">{c.sentAt ? formatDate(c.sentAt, "en-GB", true) : c.scheduledAt ? formatDate(c.scheduledAt, "en-GB", true) : ""}</div></TD>
                    <TD className="text-right tabular-nums">{c.stats.sent}{c.stats.skipped ? <div className="text-xs text-muted-foreground">{c.stats.skipped} skipped</div> : null}</TD>
                    <TD className="text-right tabular-nums">{c.stats.opened} <span className="text-xs text-muted-foreground">{pct(c.stats.opened, c.stats.sent)}</span></TD>
                    <TD className="text-right tabular-nums">{c.stats.clicked} <span className="text-xs text-muted-foreground">{pct(c.stats.clicked, c.stats.sent)}</span></TD>
                    <TD className="text-right tabular-nums">{c.stats.orders}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(c.stats.revenue, "en")}</TD>
                  </TR>
                );
              })}
              {!rows.length && <EmptyRow colSpan={9}>No campaigns yet.</EmptyRow>}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
