import { MessagesSquare } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { chatOverview } from "@/server/chat/service";
import { CHANNEL_LABEL } from "@/lib/chat";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChatSettingsForm, ChatTabs } from "@/components/chat/admin";
import { ChatInbox } from "@/components/chat/chat-inbox";

export const metadata = { title: "Order Chat" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage", "admin.support.manage"]);
  const o = await chatOverview(ctx);
  const kpis: [string, string, string][] = [
    ["Messages (30 days)", o.messages30.toLocaleString("en-GB"), "kpi-messages"],
    ["Flagged (30 days)", o.flagged30.toLocaleString("en-GB"), "kpi-flagged"],
    ["Flagged, not reviewed", o.openFlags.toLocaleString("en-GB"), "kpi-open-flags"],
    ["Translations made (30 days)", o.translated30.toLocaleString("en-GB"), "kpi-translated"],
  ];
  return (
    <>
      <PageHeader title="Order Chat" icon={MessagesSquare}
        description="Conversations on orders between customers, suppliers, drivers and FIRINGI. Choose who can talk; contact details are hidden so business stays on FIRINGI; messages are translated into each reader's language. FIRINGI reads every conversation." />
      <ChatTabs active="/admin/orders/chat" flagged={o.openFlags} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="chat-kpis">
        {kpis.map(([label, value, id]) => (
          <Card key={id}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{label}</p><p className="kpi-value text-2xl font-semibold tabular-nums" data-testid={id}>{value}</p></CardContent></Card>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="chat-channels">
        {o.channels.map((c) => (
          <Card key={c.channel}><CardContent className="pt-5 text-sm">
            <p className="font-medium">{CHANNEL_LABEL[c.channel]}{!o.settings.channels[c.channel] && <span className="ml-1 text-xs text-muted-foreground">(off)</span>}</p>
            <p className="text-muted-foreground">{c.threads} conversations · {c.messages} messages in 30 days</p>
          </CardContent></Card>
        ))}
      </div>
      <Card className="mt-4">
        <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
        <CardContent><ChatSettingsForm settings={o.settings} canManage={ctx.permissions.has("admin.settings.manage")} translation={o.translation} /></CardContent>
      </Card>
      <Card className="mt-4">
        <CardHeader><CardTitle>Latest conversations</CardTitle></CardHeader>
        <CardContent><ChatInbox ctx={ctx} portal="admin" /></CardContent>
      </Card>
    </>
  );
}
