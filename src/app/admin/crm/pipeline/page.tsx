import { Handshake } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { crmTargets, crmTeam, pipeline } from "@/server/services/crm";
import { PageHeader } from "@/components/layout/page-header";
import { DealForm, DealStageForm } from "@/components/crm/forms";
import { Pills, eur, pretty, when } from "@/components/crm/views";
import { PipelineBoard } from "@/components/crm/pipeline-board";

export const metadata = { title: "Sales Pipeline" };

export default async function Page({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.crm.view", "admin.crm.manage"]);
  const sp = await searchParams;
  const manage = can(ctx, "admin.crm.manage");
  const [cols, team, targets] = await Promise.all([pipeline(ctx, { ownerId: sp.owner === "me" ? ctx.user.id : undefined }), crmTeam(ctx), crmTargets(ctx)]);
  const open = cols.filter((c) => c.stage !== "WON" && c.stage !== "LOST");
  return (
    <>
      <PageHeader icon={Handshake} eyebrow="CRM" title="Sales Pipeline" description={`Open: ${eur(open.reduce((a, c) => a + c.value, 0))} expected monthly business · weighted ${eur(open.reduce((a, c) => a + c.weighted, 0))}. Won / lost deals stay visible for 90 days.`} />
      <div className="mb-3 flex flex-wrap items-start gap-3">
        {manage && <DealForm team={team.map((t) => ({ id: t.id, label: t.name }))} targets={{ companies: targets.companies.map((c) => ({ id: c.id, label: c.legalName })), leads: targets.leads.map((l) => ({ id: l.id, label: `${l.companyName} (${l.number})` })) }} />}
        <Pills items={[{ value: "", label: "Everyone's" }, { value: "me", label: "Mine" }]} current={sp.owner ?? ""} param="owner" base={{}} />
      </div>
      <PipelineBoard manage={manage} columns={cols.map((c) => ({
        stage: c.stage, label: pretty(c.stage), total: eur(c.value), weighted: c.stage !== "WON" && c.stage !== "LOST" ? eur(c.weighted) : null,
        deals: c.deals.map((d) => ({
          id: d.id, title: d.title, who: d.company?.legalName ?? d.lead?.companyName ?? "—", owner: d.owner?.name ?? "—", value: eur(d.valueNet), probability: d.probability,
          close: d.expectedCloseAt ? when(d.expectedCloseAt) : null, stage: d.stage, picker: manage ? <DealStageForm id={d.id} stage={d.stage} /> : undefined,
        })),
      }))} />
    </>
  );
}
