import Link from "next/link";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { crmCountries, crmTeam, listLeads } from "@/server/services/crm";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
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
  const [rows, team, countries] = await Promise.all([listLeads(ctx, { status: status === "ALL" ? undefined : (status as "OPEN"), ownerId: owner, q: sp.q }), crmTeam(ctx), crmCountries()]);
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
      <Card><CardContent className="pt-5">
        <Table data-testid="leads-table">
          <THead><TR><TH>Lead</TH><TH>Business</TH><TH>Becomes</TH><TH>Source</TH><TH>Owner</TH><TH className="text-right">Monthly (est.)</TH><TH>Next task</TH><TH>Status</TH></TR></THead>
          <TBody>
            {rows.map((l) => (
              <TR key={l.id}>
                <TD><Link className="font-medium text-primary hover:underline" href={`/admin/crm/leads/${l.id}`}>{l.number}</Link></TD>
                <TD>{l.companyName}<div className="text-xs text-muted-foreground">{l.country.flag} {l.city ?? ""} {l.contactName ? `· ${l.contactName}` : ""}</div></TD>
                <TD>{pretty(l.kind)}</TD>
                <TD>{pretty(l.source)}</TD>
                <TD>{l.owner?.name ?? "—"}</TD>
                <TD className="text-right tabular-nums">{l.estimatedMonthlyNet ? eur(l.estimatedMonthlyNet) : "—"}</TD>
                <TD className="text-xs">{l.tasks[0] ? when(l.tasks[0].dueAt) : "—"}</TD>
                <TD><LeadBadge status={l.status} />{l.convertedCompany && <div className="text-xs"><Link className="hover:underline" href={`/admin/crm/accounts/${l.convertedCompany.id}`}>{l.convertedCompany.legalName}</Link></div>}</TD>
              </TR>
            ))}
            {!rows.length && <EmptyRow colSpan={8}>No leads here.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
