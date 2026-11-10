import Link from "next/link";
import { notFound } from "next/navigation";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { account360, crmTeam } from "@/server/services/crm";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountForm, ActivityForm, ContactForm, DealForm, TaskForm } from "@/components/crm/forms";
import { TaskList, TicketBadge, Timeline, eur, pretty, when } from "@/components/crm/views";

export const metadata = { title: "Account" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.crm.view", "admin.crm.manage"]);
  const { id } = await params;
  const r = await account360(ctx, id).catch(() => null);
  if (!r) notFound();
  const { company: c, orders, totals } = r;
  const manage = can(ctx, "admin.crm.manage");
  const team = (await crmTeam(ctx)).map((t) => ({ id: t.id, label: t.name }));
  const target = { companyId: c.id };
  const sells = c.type === "DISTRIBUTOR";
  return (
    <>
      <PageHeader title={c.tradeName ?? c.legalName} description={<span>{c.country.flag} {c.legalName} · {pretty(c.type)} · {c.vatNumber ?? c.taxId} · <Link className="text-primary hover:underline" href={`/admin/companies/${c.id}`}>Company file →</Link></span>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="account-kpis">
        {[[sells ? "Sold, 90 days" : "Bought, 90 days", eur(totals.net90)], ["Orders, 30 days", String(totals.n30)], ["Orders, 90 days", String(totals.n90)], ["Since first order", eur(totals.netAll)], ["Last order", when(totals.last)]].map(([k, v]) => (
          <div key={k} className="rounded-lg border bg-card p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="text-lg font-semibold tabular-nums">{v}</div></div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Communications & notes</CardTitle></CardHeader>
            <CardContent className="space-y-3">{manage && <ActivityForm target={target} />}<Timeline items={c.crmActivities} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Tasks & follow-ups</CardTitle></CardHeader>
            <CardContent className="space-y-3">{manage && <TaskForm target={target} team={team} kind="FOLLOW_UP" />}<TaskList items={c.crmTasks.map((t) => ({ ...t, company: null, lead: null, deal: null }))} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Recent orders</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {orders.map((o) => <div key={o.id} className="flex flex-wrap gap-2"><Link className="text-primary hover:underline" href={`/admin/orders/${o.id}`}>{o.number}</Link><span className="text-muted-foreground">{when(o.placedAt)} · {pretty(o.status)} · {sells ? o.buyer.legalName : o.seller.legalName}</span><span className="ml-auto tabular-nums">{eur(o.netTotal)}</span></div>)}
              {!orders.length && <p className="text-muted-foreground">No orders yet.</p>}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Account</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {manage ? <AccountForm companyId={c.id} ownerId={c.crmAccount?.ownerId ?? null} tier={c.crmAccount?.tier ?? null} tags={c.crmAccount?.tags ?? []} team={team} />
                : <div>Manager: {c.crmAccount?.owner?.name ?? "—"} · Tier {c.crmAccount?.tier ?? "—"} · {c.crmAccount?.tags.join(", ")}</div>}
              {c.leadsConverted.map((l) => <div key={l.id} className="text-xs text-muted-foreground">From lead <Link className="hover:underline" href={`/admin/crm/leads/${l.id}`}>{l.number}</Link> ({pretty(l.source)}, {when(l.createdAt)})</div>)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>People</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {c.crmContacts.map((p) => <div key={p.id}><span className="font-medium">{p.name}</span>{p.isPrimary && " ★"}{p.jobTitle && <span className="text-muted-foreground"> · {p.jobTitle}</span>}<div className="text-xs text-muted-foreground">{[p.phone, p.email].filter(Boolean).join(" · ")}</div></div>)}
              {c.memberships.map((m) => <div key={m.user.id}><span>{m.user.name}</span><span className="text-xs text-muted-foreground"> · platform user{m.isOwner ? " (owner)" : ""} · {m.user.email}{m.user.phone ? ` · ${m.user.phone}` : ""}</span></div>)}
              {manage && <ContactForm target={target} />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Deals</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {c.deals.map((d) => <div key={d.id}><Link className="text-primary hover:underline" href={`/admin/crm/pipeline/${d.id}`}>{d.number} {d.title}</Link><div className="text-xs text-muted-foreground">{pretty(d.stage)} · {eur(d.valueNet)}/month · {d.owner?.name ?? "—"}</div></div>)}
              {manage && <DealForm target={target} team={team} />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Support requests</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {c.supportTickets.map((t) => <div key={t.id} className="flex flex-wrap items-center gap-2"><Link className="text-primary hover:underline" href={`/admin/customers/support/${t.id}`}>{t.number}</Link><span className="truncate">{t.subject}</span><TicketBadge status={t.status} /></div>)}
              {!c.supportTickets.length && <p className="text-muted-foreground">None.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
