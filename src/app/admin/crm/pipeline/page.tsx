import Link from "next/link";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { crmTargets, crmTeam, pipeline } from "@/server/services/crm";
import { PageHeader } from "@/components/layout/page-header";
import { DealForm, DealStageForm } from "@/components/crm/forms";
import { Pills, eur, pretty, when } from "@/components/crm/views";

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
      <PageHeader title="Sales Pipeline" description={`Open: ${eur(open.reduce((a, c) => a + c.value, 0))} expected monthly business · weighted ${eur(open.reduce((a, c) => a + c.weighted, 0))}. Won / lost deals stay visible for 90 days.`} />
      <div className="mb-3 flex flex-wrap items-start gap-3">
        {manage && <DealForm team={team.map((t) => ({ id: t.id, label: t.name }))} targets={{ companies: targets.companies.map((c) => ({ id: c.id, label: c.legalName })), leads: targets.leads.map((l) => ({ id: l.id, label: `${l.companyName} (${l.number})` })) }} />}
        <Pills items={[{ value: "", label: "Everyone's" }, { value: "me", label: "Mine" }]} current={sp.owner ?? ""} param="owner" base={{}} />
      </div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="pipeline">
        {cols.map((c) => (
          <section key={c.stage} className="rounded-lg border bg-muted/30 p-2" data-testid={`stage-${c.stage}`}>
            <header className="mb-2 px-1">
              <div className="text-sm font-semibold">{pretty(c.stage)} <span className="text-muted-foreground">({c.deals.length})</span></div>
              <div className="text-xs text-muted-foreground tabular-nums">{eur(c.value)}{c.stage !== "WON" && c.stage !== "LOST" ? ` · weighted ${eur(c.weighted)}` : ""}</div>
            </header>
            <ul className="space-y-2">
              {c.deals.map((d) => (
                <li key={d.id} className="rounded-md border bg-card p-2 text-sm shadow-sm">
                  <Link className="font-medium text-primary hover:underline" href={`/admin/crm/pipeline/${d.id}`}>{d.title}</Link>
                  <div className="text-xs text-muted-foreground">{d.company?.legalName ?? d.lead?.companyName} · {d.owner?.name ?? "—"}</div>
                  <div className="text-xs tabular-nums">{eur(d.valueNet)}/month · {d.probability}%{d.expectedCloseAt ? ` · close ${when(d.expectedCloseAt)}` : ""}</div>
                  {manage && <div className="mt-1"><DealStageForm id={d.id} stage={d.stage} /></div>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
