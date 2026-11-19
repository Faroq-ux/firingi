import { Building2 } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { can } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { adminPosCompanies, adminTillRequests } from "@/server/pos/service";
import { POS_PROVIDER_INFO, type PosProvider } from "@/lib/pos";
import { CompanyStateSelect, TillDecision } from "@/components/pos/admin";
import { CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Till per Company" };
export const dynamic = "force-dynamic";

const TYPE = { DISTRIBUTOR: "Distributor", WHOLESALER: "Wholesaler", CUSTOMER: "Customer" } as Record<string, string>;
const WHY = { ok: "On", off: "Till switched off", type: "Off for its type", country: "Off in its country", company: "Switched off for it" } as Record<string, string>;

export default async function Page({ searchParams }: { searchParams: Promise<{ type?: string; q?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.manage", "admin.vendors.view", "admin.customers.view", "admin.finance.view"]);
  const sp = await searchParams;
  const rows = await adminPosCompanies(ctx, sp);
  const requests = await adminTillRequests(ctx);
  const manage = can(ctx, "admin.settings.manage");
  return (
    <>
      <PageHeader title="Till per Company" icon={Building2} description="Switch the till on or off for one distributor, wholesaler or wholesale customer, whatever its type's switch says." />
      <Card className="mb-4"><CardHeader><CardTitle>Extra tills waiting for approval</CardTitle></CardHeader><CardContent className="overflow-x-auto">
        <Table data-testid="pos-till-requests">
          <THead><TR><TH>Company</TH><TH>Type</TH><TH>Till</TH><TH className="text-right">Tills</TH><TH>Asked</TH><TH>Decision</TH></TR></THead>
          <TBody>
            {requests.length === 0 && <EmptyRow colSpan={6}>No requests.</EmptyRow>}
            {requests.map((r) => (
              <TR key={r.id} data-testid="pos-till-request">
                <TD className="min-w-0 break-words">{r.company.legalName} <span className="text-xs text-muted-foreground">{r.company.country.code}</span></TD><TD>{TYPE[r.company.type]}</TD>
                <TD>{r.code} · {r.name}</TD><TD className="text-right">{r.company._count.posRegisters}</TD><TD className="whitespace-nowrap text-xs">{r.createdAt.toISOString().slice(0, 10)}</TD>
                <TD>{r.approval === "PENDING" ? (manage ? <TillDecision id={r.id} /> : <Badge variant="warning">Waiting</Badge>) : <Badge variant={r.approval === "APPROVED" ? "success" : "destructive"} className="shrink-0 whitespace-nowrap">{r.approval === "APPROVED" ? "Approved" : `Refused${r.decisionNote ? ` — ${r.decisionNote}` : ""}`}</Badge>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent></Card>
      <form className="mb-3 flex flex-wrap gap-2 text-sm">
        <select name="type" defaultValue={sp.type ?? ""} className="h-9 rounded-md border bg-background px-2"><option value="">All types</option><option value="DISTRIBUTOR">Distributors</option><option value="WHOLESALER">Wholesalers</option><option value="CUSTOMER">Customers</option></select>
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Company" className="h-9 rounded-md border bg-background px-2" />
        <button className="h-9 rounded-md border px-3">Filter</button>
      </form>
      <Card><CardContent className="overflow-x-auto pt-5">
        <Table data-testid="pos-companies">
          <THead><TR><TH>Company</TH><TH>Type</TH><TH>Country</TH><TH>Till</TH><TH>FIRINGI&apos;s switch</TH><TH className="text-right">Tills</TH><TH className="text-right">Sales (30 days)</TH><TH>Certified provider</TH></TR></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={8}>No companies.</EmptyRow>}
            {rows.map((r) => (
              <TR key={r.id} data-testid="pos-company-row">
                <TD className="min-w-0 break-words font-medium">{r.name}</TD><TD>{TYPE[r.type]}</TD><TD>{r.country}</TD>
                <TD><Badge variant={r.on ? "success" : "secondary"} className="shrink-0 whitespace-nowrap">{WHY[r.reason]}</Badge></TD>
                <TD>{manage ? <CompanyStateSelect companyId={r.id} state={r.adminState} /> : r.adminState}</TD>
                <TD className="text-right">{r.registers}</TD><TD className="text-right">{r.sales30}</TD>
                <TD className="text-xs">{r.provider ? `${POS_PROVIDER_INFO[r.provider as PosProvider]?.name ?? r.provider}${r.providerOk === false ? " — test failed" : ""}` : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
