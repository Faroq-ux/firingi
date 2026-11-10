import Link from "next/link";
import { notFound } from "next/navigation";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { crmTargets, crmTeam, leadDetail } from "@/server/services/crm";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityForm, ContactForm, ConvertLeadForm, DealForm, LeadStatusForm, TaskForm } from "@/components/crm/forms";
import { LeadBadge, TaskList, Timeline, eur, pretty, when } from "@/components/crm/views";

export const metadata = { title: "Lead" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.crm.view", "admin.crm.manage"]);
  const { id } = await params;
  const l = await leadDetail(ctx, id).catch(() => null);
  if (!l) notFound();
  const manage = can(ctx, "admin.crm.manage");
  const [team, targets] = await Promise.all([crmTeam(ctx), crmTargets(ctx)]);
  const teamOpts = team.map((t) => ({ id: t.id, label: t.name }));
  const target = { leadId: l.id };
  return (
    <>
      <PageHeader title={`${l.companyName}`} description={<span className="flex flex-wrap items-center gap-2">{l.number} · <LeadBadge status={l.status} /> · becomes a {pretty(l.kind).toLowerCase()} · {pretty(l.source)} · created {when(l.createdAt)}</span>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
            <CardContent className="space-y-3">{manage && l.status !== "CONVERTED" && <ActivityForm target={target} />}<Timeline items={l.activities} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Tasks & follow-ups</CardTitle></CardHeader>
            <CardContent className="space-y-3">{manage && <TaskForm target={target} team={teamOpts} kind="FOLLOW_UP" />}<TaskList items={l.tasks.map((t) => ({ ...t, company: null, lead: null, deal: null }))} /></CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>{l.contactName ?? "—"}{l.email && <> · <a className="text-primary hover:underline" href={`mailto:${l.email}`}>{l.email}</a></>}{l.phone && <> · <a className="text-primary hover:underline" href={`tel:${l.phone}`}>{l.phone}</a></>}</div>
              <div>{l.country.flag} {l.city ?? ""}</div>
              <div>Expected monthly orders: <b>{l.estimatedMonthlyNet ? eur(l.estimatedMonthlyNet) : "—"}</b></div>
              {l.notes && <p className="whitespace-pre-line text-muted-foreground">{l.notes}</p>}
              {l.lostReason && <p className="text-destructive">Lost: {l.lostReason}</p>}
              {l.convertedCompany && <p>Converted to <Link className="text-primary hover:underline" href={`/admin/crm/accounts/${l.convertedCompany.id}`}>{l.convertedCompany.legalName}</Link> on {when(l.convertedAt)}</p>}
              {manage && l.status !== "CONVERTED" && <><LeadStatusForm id={l.id} status={l.status} ownerId={l.owner?.id ?? null} team={teamOpts} /><ConvertLeadForm leadId={l.id} companies={targets.companies.map((c) => ({ id: c.id, label: `${c.legalName} (${pretty(c.type).toLowerCase()})` }))} /></>}
              {!manage && <div>Owner: {l.owner?.name ?? "—"}</div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Contacts</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {l.contacts.map((c) => <div key={c.id}><span className="font-medium">{c.name}</span>{c.isPrimary && " ★"}{c.jobTitle && <span className="text-muted-foreground"> · {c.jobTitle}</span>}<div className="text-xs text-muted-foreground">{[c.phone, c.email].filter(Boolean).join(" · ")}</div></div>)}
              {manage && <ContactForm target={target} />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Deals</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {l.deals.map((d) => <div key={d.id}><Link className="text-primary hover:underline" href={`/admin/crm/pipeline/${d.id}`}>{d.number} {d.title}</Link> · {pretty(d.stage)} · {eur(d.valueNet)}</div>)}
              {manage && <DealForm target={target} team={teamOpts} />}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
