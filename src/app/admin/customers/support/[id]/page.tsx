import Link from "next/link";
import { notFound } from "next/navigation";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { ticketDetail } from "@/server/services/support";
import { crmTeam } from "@/server/services/crm";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TicketAdminForm } from "@/components/crm/forms";
import { ReplyForm } from "@/components/crm/ticket-forms";
import { Thread } from "@/components/crm/ticket-views";
import { TicketBadge, pretty, when } from "@/components/crm/views";

export const metadata = { title: "Support request" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.support.manage", "admin.crm.view", "admin.customers.view"]);
  const { id } = await params;
  const r = await ticketDetail(ctx, id).catch(() => null);
  if (!r) notFound();
  const t = r.ticket;
  const team = can(ctx, ["admin.crm.view", "admin.support.manage"]) ? (await crmTeam(ctx).catch(() => [])).map((u) => ({ id: u.id, label: u.name })) : [];
  return (
    <>
      <PageHeader title={`${t.number} · ${t.subject}`} description={<span className="flex flex-wrap items-center gap-2"><TicketBadge status={t.status} /> {pretty(t.category)} · {pretty(t.priority)} priority · opened {when(t.createdAt, true)}</span>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card><CardContent className="space-y-4 pt-5">
            <Thread messages={t.messages} locale="en-GB" staff l={{ you: "You", firingi: "FIRINGI", internalNote: "Internal note" }} />
            {r.canAnswer && <ReplyForm id={t.id} staff l={{ reply: "Reply", replyPlaceholder: "Write the answer to the company…", send: "Send answer", sendResolve: "Send and resolve", internal: "Internal note (not shown to the company)", addNote: "Add internal note" }} />}
          </CardContent></Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Company</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <Link className="font-medium text-primary hover:underline" href={`/admin/crm/accounts/${t.company.id}`}>{t.company.legalName}</Link>
              <div className="text-muted-foreground">{pretty(t.company.type)}{t.company.phone ? ` · ${t.company.phone}` : ""}</div>
              <div>Asked by {t.openedBy.name} · {t.openedBy.email}</div>
              {t.order && <div>Order <Link className="text-primary hover:underline" href={`/admin/orders/${t.order.id}`}>{t.order.number}</Link> · {pretty(t.order.status)}</div>}
            </CardContent>
          </Card>
          {r.canAnswer && <Card><CardHeader><CardTitle>Handling</CardTitle></CardHeader><CardContent><TicketAdminForm id={t.id} assigneeId={t.assignee?.id ?? null} priority={t.priority} status={t.status} team={team} /></CardContent></Card>}
        </div>
      </div>
    </>
  );
}
