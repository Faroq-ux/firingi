import Link from "next/link";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { crmCountries, crmTeam, listLeads } from "@/server/services/crm";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";
import { listViews } from "@/server/services/workspace";
import { NewLeadForm } from "@/components/crm/forms";
import { LeadBadge, Pills, eur, pretty, when } from "@/components/crm/views";

export const metadata = { title: "Leads" };
const TABS = [{ value: "OPEN", label: "Open" }, { value: "NEW", label: "New" }, { value: "CONTACTED", label: "Contacted" }, { value: "QUALIFIED", label: "Qualified" }, { value: "CONVERTED", label: "Converted" }, { value: "LOST", label: "Lost" }, { value: "ALL", label: "All" }];

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string; owner?: string; q?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.crm.view", "admin.crm.manage"]);
  const sp = await searchParams;
  const status = TABS.some((t) => t.value === sp.status) ? sp.status! : "OPEN";
  const owner = sp.owner === "me" ? ctx.user.id : undefined;
  const [rows, team, countries, views] = await Promise.all([listLeads(ctx, { status: status === "ALL" ? undefined : (status as "OPEN"), ownerId: owner, q: sp.q }), crmTeam(ctx), crmCountries(), listViews(ctx, "admin.crm-leads")]);
  return (
    <>
      <PageHeader title="Leads" description="Businesses we want on FIRINGI. A lead converts automatically when its company registers with the same e-mail and is approved, or you link it by hand." />
      <div className="mb-3 space-y-2">
        {can(ctx, "admin.crm.manage") && <NewLeadForm countries={countries} team={team.map((t) => ({ id: t.id, label: t.name }))} defaultCountry={ctx.company.countryCode} />}
        <div className="flex flex-wrap items-center gap-3">
          <Pills items={TABS} current={status} param="status" base={{ owner: sp.owner, q: sp.q }} />
          <Pills items={[{ value: "", label: "Everyone's" }, { value: "me", label: "Mine" }]} current={sp.owner ?? ""} param="owner" base={{ status, q: sp.q }} />
          <form className="flex gap-1"><input type="hidden" name="status" value={status} /><input name="q" defaultValue={sp.q} placeholder="Search…" className="h-8 rounded-md border bg-card px-2 text-sm" /></form>
        </div>
      </div>
      <DataTable tableId="admin.crm-leads" views={views} testId="leads-table" empty="No leads here." exportName="leads"
        columns={[{ key: "lead", label: "Lead" }, { key: "business", label: "Business" }, { key: "kind", label: "Becomes", type: "badge" }, { key: "source", label: "Source", type: "badge" }, { key: "owner", label: "Owner", type: "badge" }, { key: "monthly", label: "Monthly (est.)", type: "money" }, { key: "next", label: "Next task", type: "date" }, { key: "status", label: "Status", type: "badge" }]}
        rows={rows.map((l) => ({
          id: l.id, href: `/admin/crm/leads/${l.id}`,
          cells: {
            lead: { t: l.number, mono: true }, business: { t: l.companyName, sub: `${l.country.flag ?? ""} ${l.city ?? ""} ${l.contactName ? `· ${l.contactName}` : ""}`.trim() },
            kind: pretty(l.kind), source: pretty(l.source), owner: l.owner?.name ?? "—",
            monthly: { t: l.estimatedMonthlyNet ? eur(l.estimatedMonthlyNet) : "—", v: Number(l.estimatedMonthlyNet ?? 0) },
            next: { t: l.tasks[0] ? when(l.tasks[0].dueAt) : "—", v: l.tasks[0]?.dueAt.getTime() ?? null },
            status: { t: pretty(l.status), node: <><LeadBadge status={l.status} />{l.convertedCompany && <span className="block text-xs"><Link className="hover:underline" href={`/admin/crm/accounts/${l.convertedCompany.id}`}>{l.convertedCompany.legalName}</Link></span>}</> },
          },
        }))} />
    </>
  );
}
