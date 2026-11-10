import Link from "next/link";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { crmTargets, listContacts } from "@/server/services/crm";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ContactForm } from "@/components/crm/forms";
import { pretty } from "@/components/crm/views";

export const metadata = { title: "Contacts" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.crm.view", "admin.crm.manage"]);
  const { q } = await searchParams;
  const [rows, targets] = await Promise.all([listContacts(ctx, q), crmTargets(ctx)]);
  return (
    <>
      <PageHeader title="Contacts" description="People at our accounts and leads — buyers, owners, managers. Platform users are listed on each account." />
      <div className="mb-3 flex flex-wrap items-start gap-3">
        {can(ctx, "admin.crm.manage") && <ContactForm targets={{ companies: targets.companies.map((c) => ({ id: c.id, label: c.legalName })), leads: targets.leads.map((l) => ({ id: l.id, label: `${l.companyName} (${l.number})` })) }} />}
        <form><input name="q" defaultValue={q} placeholder="Name, phone, e-mail, company…" className="h-8 w-72 rounded-md border bg-card px-2 text-sm" /></form>
      </div>
      <Card><CardContent className="pt-5">
        <Table data-testid="contacts-table">
          <THead><TR><TH>Name</TH><TH>Job title</TH><TH>Phone</TH><TH>E-mail</TH><TH>Company / lead</TH></TR></THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD className="font-medium">{c.name}{c.isPrimary && " ★"}</TD>
                <TD>{c.jobTitle ?? "—"}</TD>
                <TD>{c.phone ? <a className="hover:underline" href={`tel:${c.phone}`}>{c.phone}</a> : "—"}</TD>
                <TD>{c.email ? <a className="hover:underline" href={`mailto:${c.email}`}>{c.email}</a> : "—"}</TD>
                <TD>{c.company ? <Link className="text-primary hover:underline" href={`/admin/crm/accounts/${c.company.id}`}>{c.company.legalName}</Link> : c.lead ? <Link className="text-primary hover:underline" href={`/admin/crm/leads/${c.lead.id}`}>{c.lead.companyName} (lead, {pretty(c.lead.status).toLowerCase()})</Link> : "—"}</TD>
              </TR>
            ))}
            {!rows.length && <EmptyRow colSpan={5}>No contacts.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
