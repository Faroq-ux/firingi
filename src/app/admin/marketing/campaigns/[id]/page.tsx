import Link from "next/link";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { getCampaign } from "@/server/marketing/campaigns";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { CampaignActions, CHANNEL_INFO } from "@/components/marketing/campaign-forms";
import { STATUS_TONE } from "@/components/marketing/campaigns-view";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Campaign" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage"]);
  const c = await getCampaign(ctx, (await params).id);
  const s = c.stats;
  const texts = (v: unknown) => Object.entries((v ?? {}) as Record<string, string>);
  const channels = [...new Set(c.byChannel.map((b) => b.channel))];
  return (
    <>
      <PageHeader title={c.name} description={<span className="flex flex-wrap items-center gap-2"><Badge variant={STATUS_TONE[c.status]}>{c.status.toLowerCase()}</Badge>
        {c.sentAt ? `sent ${formatDate(c.sentAt, "en-GB", true)}` : c.scheduledAt ? `scheduled for ${formatDate(c.scheduledAt, "en-GB", true)}` : "draft"}
        {c.segment && <>· segment <Link className="text-primary hover:underline" href="/admin/crm/segments">{c.segment.name}</Link></>}
        {c.promotion && <>· offer <b className="font-mono">{c.promotion.code ?? (c.promotion.name as { en?: string }).en}</b></>}</span>}
        actions={can(ctx, "admin.marketing.manage") ? <CampaignActions id={c.id} status={c.status} /> : null} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="campaign-stats">
        <Kpi label="Delivered" value={s.sent} fmt="number" locale="en" hint={`${s.skipped} skipped · ${s.failed} failed`} index={0} />
        <Kpi label="Opened" value={s.opened} fmt="number" locale="en" index={1} />
        <Kpi label="Clicked" value={s.clicked} fmt="number" locale="en" hint={`${s.companiesClicked} companies`} index={2} />
        <Kpi label="Orders" value={s.orders} fmt="number" locale="en" index={3} />
        <Kpi label="Goods sold (net)" value={s.revenue} fmt="money" locale="en" index={4} />
        <Kpi label="Offer cost" value={s.discount} fmt="money" locale="en" index={5} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>By channel</CardTitle></CardHeader>
          <CardContent>
            <Table data-testid="by-channel">
              <THead><TR><TH>Channel</TH><TH className="text-right">Sent</TH><TH className="text-right">Skipped</TH><TH className="text-right">Failed</TH></TR></THead>
              <TBody>
                {channels.map((ch) => {
                  const n = (st: string) => c.byChannel.find((b) => b.channel === ch && b.status === st)?.count ?? 0;
                  return <TR key={ch}><TD>{CHANNEL_INFO[ch as keyof typeof CHANNEL_INFO]?.label ?? ch}</TD><TD className="text-right tabular-nums">{n("SENT")}</TD><TD className="text-right tabular-nums">{n("SKIPPED")}</TD><TD className="text-right tabular-nums">{n("FAILED")}</TD></TR>;
                })}
                {!channels.length && <EmptyRow colSpan={4}>Not sent yet — channels: {c.channels.join(", ")}.</EmptyRow>}
              </TBody>
            </Table>
            {c.skipped.length > 0 && <div className="mt-3 text-sm"><div className="mb-1 font-medium">Why people were skipped</div><ul className="space-y-0.5">{c.skipped.map((x) => <li key={x.reason} className="flex justify-between"><span>{x.reason}</span><span className="tabular-nums">{x.count}</span></li>)}</ul></div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Message</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {texts(c.subject).map(([l, subj]) => (
              <div key={l} className="rounded-lg border p-3"><div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{l}</div><div className="font-semibold">{subj}</div><p className="whitespace-pre-line">{(c.body as Record<string, string>)[l] ?? ""}</p></div>
            ))}
            <p className="text-xs text-muted-foreground">Button opens {c.ctaPath ?? "/buy/catalogue/deals"}{c.waTemplateName ? ` · WhatsApp template ${c.waTemplateName}` : ""}</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
