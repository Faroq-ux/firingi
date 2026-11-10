import Link from "next/link";
import type { TicketStatus } from "@prisma/client";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listTickets, ticketCounts } from "@/server/services/support";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Pills, TicketBadge, pretty, when } from "@/components/crm/views";

export const metadata = { title: "Customer Support" };
const PRIO: Record<string, "default" | "secondary" | "warning" | "destructive"> = { LOW: "secondary", NORMAL: "default", HIGH: "warning", URGENT: "destructive" };

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string; who?: string; q?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.support.manage", "admin.crm.view", "admin.customers.view"]);
  const sp = await searchParams;
  const status = ["OPEN", "PENDING_CUSTOMER", "RESOLVED", "CLOSED", "ALL"].includes(sp.status ?? "") ? sp.status! : "ACTIVE";
  const assigneeId = sp.who === "me" ? ctx.user.id : sp.who === "none" ? "none" : undefined;
  const [rows, counts] = await Promise.all([listTickets(ctx, { status: status === "ALL" ? undefined : (status as TicketStatus | "ACTIVE"), assigneeId, q: sp.q }), ticketCounts(ctx)]);
  const base = { status, who: sp.who, q: sp.q };
  return (
    <>
      <PageHeader title="Customer Support" description="Requests from customers, wholesalers and distributors. Answers go to the person who asked (in their language’s app and by e-mail); internal notes stay inside FIRINGI." />
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="support-tiles">
        {[["Waiting for us", counts.OPEN ?? 0, "OPEN"], ["Not assigned", counts.unassigned, "OPEN"], ["Waiting for the company", counts.PENDING_CUSTOMER ?? 0, "PENDING_CUSTOMER"], ["Resolved", counts.RESOLVED ?? 0, "RESOLVED"]].map(([label, n, s], i) => (
          <Link key={i} href={`?status=${s}${i === 1 ? "&who=none" : ""}`} className="rounded-lg border bg-card p-3 hover:shadow-sm"><div className="text-xs text-muted-foreground">{label}</div><div className="text-2xl font-semibold tabular-nums">{n}</div></Link>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Pills items={[{ value: "ACTIVE", label: "Active" }, { value: "OPEN", label: "Waiting for us" }, { value: "PENDING_CUSTOMER", label: "Waiting for the company" }, { value: "RESOLVED", label: "Resolved" }, { value: "ALL", label: "All" }]} current={status} param="status" base={base} />
        <Pills items={[{ value: "", label: "Anyone" }, { value: "me", label: "Mine" }, { value: "none", label: "Not assigned" }]} current={sp.who ?? ""} param="who" base={base} />
        <form><input type="hidden" name="status" value={status} /><input name="q" defaultValue={sp.q} placeholder="Number, subject, company…" className="h-8 rounded-md border bg-card px-2 text-sm" /></form>
      </div>
      <Card><CardContent className="pt-5">
        <Table data-testid="tickets-table">
          <THead><TR><TH>Request</TH><TH>Company</TH><TH>Subject</TH><TH>Topic</TH><TH>Priority</TH><TH>Assigned</TH><TH>Last message</TH><TH>Status</TH></TR></THead>
          <TBody>
            {rows.map((t) => (
              <TR key={t.id}>
                <TD><Link className="font-medium text-primary hover:underline" href={`/admin/customers/support/${t.id}`}>{t.number}</Link></TD>
                <TD><Link className="hover:underline" href={`/admin/crm/accounts/${t.company.id}`}>{t.company.legalName}</Link><div className="text-xs text-muted-foreground">{pretty(t.company.type)}</div></TD>
                <TD>{t.subject}{t.order && <div className="text-xs text-muted-foreground">{t.order.number}</div>}</TD>
                <TD>{pretty(t.category)}</TD>
                <TD><Badge variant={PRIO[t.priority]}>{pretty(t.priority)}</Badge></TD>
                <TD>{t.assignee?.name ?? <span className="text-muted-foreground">—</span>}</TD>
                <TD className="text-xs">{when(t.lastMessageAt, true)} · {t._count.messages} msg</TD>
                <TD><TicketBadge status={t.status} /></TD>
              </TR>
            ))}
            {!rows.length && <EmptyRow colSpan={8}>No requests here.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
