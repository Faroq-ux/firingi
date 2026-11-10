import { Download } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listDataRequests } from "@/server/services/privacy";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ErasureActions } from "@/components/admin/security-admin-forms";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Data Privacy" };
const VARIANT = { REQUESTED: "warning", COMPLETED: "success", REJECTED: "destructive", WITHDRAWN: "secondary" } as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.users.manage", "admin.settings.manage"]);
  const { status } = await searchParams;
  const rows = await listDataRequests(ctx, status || undefined);
  return (
    <>
      <PageHeader title="Data Privacy" description="GDPR requests. People download their own data any time (Security › My data); deletion requests come here — answer within one month." />
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>What deletion does</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Name, e-mail, phone, consents, password, two-factor, devices, notifications and message texts are removed and the account is disabled.
            Orders and invoices stay (Portuguese law: invoicing records for 10 years) and the append-only audit trail stays as a security record — all now point to the anonymised account.
            A company&apos;s only owner can&apos;t be deleted until someone else is owner (or the company is closed).
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Request received another way</CardTitle><CardDescription>E-mail or letter: export the person&apos;s data to send them.</CardDescription></CardHeader>
          <CardContent>
            <form action="/api/admin/privacy-export" method="get" className="flex flex-wrap gap-2">
              <input name="email" type="email" required placeholder="person@example.com" className="h-9 w-64 rounded-md border bg-card px-3 text-sm" />
              <button className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-card px-3 text-sm hover:bg-accent"><Download className="h-4 w-4" />Export data</button>
            </form>
          </CardContent>
        </Card>
      </div>
      <form className="mb-3 flex gap-2">
        <select name="status" defaultValue={status ?? ""} className="h-9 rounded-md border bg-card px-2 text-sm"><option value="">All requests</option>{Object.keys(VARIANT).map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select>
        <button className="h-9 rounded-md border bg-card px-3 text-sm">Filter</button>
      </form>
      <Table>
        <THead><TR><TH>Requested</TH><TH>Person</TH><TH>Reason</TH><TH>Status</TH><TH>Action</TH></TR></THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={5}>No requests.</EmptyRow>}
          {rows.map((r) => (
            <TR key={r.id} data-testid="data-request">
              <TD className="whitespace-nowrap text-xs">{formatDate(r.requestedAt, "en", true)}</TD>
              <TD><div className="font-medium">{r.user.name}</div><div className="text-xs text-muted-foreground">{r.user.email} · {r.user.memberships.map((m) => m.company.legalName).join(", ")}</div></TD>
              <TD className="max-w-56 text-sm">{r.reason ?? "—"}</TD>
              <TD><Badge variant={VARIANT[r.status]}>{r.status.toLowerCase()}</Badge>{r.note && <div className="mt-1 text-xs text-muted-foreground">{r.note}</div>}</TD>
              <TD>
                {r.status === "REQUESTED" && (
                  <>
                    {r.blockers.map((b) => <p key={b} className="mb-1 text-xs text-destructive">{b}</p>)}
                    <ErasureActions id={r.id} blocked={r.blockers.length > 0 || r.userId === ctx.user.id} />
                  </>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
