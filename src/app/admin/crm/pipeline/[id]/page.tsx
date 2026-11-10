import Link from "next/link";
import { notFound } from "next/navigation";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { crmTeam, dealDetail } from "@/server/services/crm";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityForm, DealStageForm, TaskForm } from "@/components/crm/forms";
import { TaskList, Timeline, eur, pretty, when } from "@/components/crm/views";

export const metadata = { title: "Deal" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.crm.view", "admin.crm.manage"]);
  const { id } = await params;
  const d = await dealDetail(ctx, id).catch(() => null);
  if (!d) notFound();
  const manage = can(ctx, "admin.crm.manage");
  const team = (await crmTeam(ctx)).map((t) => ({ id: t.id, label: t.name }));
  const target = { dealId: d.id };
  return (
    <>
      <PageHeader title={d.title} description={<span>{d.number} · {pretty(d.stage)} · {eur(d.valueNet)}/month · {d.probability}% · owner {d.owner?.name ?? "—"}{d.expectedCloseAt ? ` · expected close ${when(d.expectedCloseAt)}` : ""}</span>} />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        {d.company && <Link className="text-primary hover:underline" href={`/admin/crm/accounts/${d.company.id}`}>{d.company.legalName} →</Link>}
        {d.lead && <Link className="text-primary hover:underline" href={`/admin/crm/leads/${d.lead.id}`}>Lead {d.lead.number} · {d.lead.companyName} →</Link>}
        {manage && <DealStageForm id={d.id} stage={d.stage} />}
        {d.lostReason && <span className="text-destructive">Lost: {d.lostReason}</span>}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Activity</CardTitle></CardHeader><CardContent className="space-y-3">{manage && <ActivityForm target={target} />}<Timeline items={d.activities} /></CardContent></Card>
        <Card><CardHeader><CardTitle>Tasks</CardTitle></CardHeader><CardContent className="space-y-3">{manage && <TaskForm target={target} team={team} kind="FOLLOW_UP" />}<TaskList items={d.tasks.map((t) => ({ ...t, company: null, lead: null, deal: null }))} /></CardContent></Card>
      </div>
    </>
  );
}
