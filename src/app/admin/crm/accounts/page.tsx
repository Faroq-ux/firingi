import Link from "next/link";
import type { CompanyType } from "@prisma/client";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { crmTeam, listAccounts } from "@/server/services/crm";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Pills, eur, pretty, when } from "@/components/crm/views";

export const metadata = { title: "Business Accounts" };

export default async function Page({ searchParams }: { searchParams: Promise<{ type?: string; owner?: string; tag?: string; q?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.crm.view", "admin.crm.manage"]);
  const sp = await searchParams;
  const type = ["CUSTOMER", "WHOLESALER", "DISTRIBUTOR"].includes(sp.type ?? "") ? (sp.type as CompanyType) : undefined;
  const ownerId = sp.owner === "me" ? ctx.user.id : sp.owner === "none" ? undefined : sp.owner || undefined;
  const [rows0, team] = await Promise.all([listAccounts(ctx, { type, ownerId, tag: sp.tag?.toLowerCase(), q: sp.q }), crmTeam(ctx)]);
  const rows = sp.owner === "none" ? rows0.filter((r) => !r.crmAccount?.ownerId) : rows0;
  const base = { type: sp.type, owner: sp.owner, tag: sp.tag, q: sp.q };
  return (
    <>
      <PageHeader title="Business Accounts" description="Approved customers, wholesalers and distributors with their account manager, tier, tags and recent business." />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Pills items={[{ value: "", label: "All" }, { value: "CUSTOMER", label: "Customers" }, { value: "WHOLESALER", label: "Wholesalers" }, { value: "DISTRIBUTOR", label: "Distributors" }]} current={sp.type ?? ""} param="type" base={base} />
        <Pills items={[{ value: "", label: "Any manager" }, { value: "me", label: "Mine" }, { value: "none", label: "No manager" }, ...team.slice(0, 6).map((t) => ({ value: t.id, label: t.name }))]} current={sp.owner ?? ""} param="owner" base={base} />
        <form className="flex gap-1">
          {sp.type && <input type="hidden" name="type" value={sp.type} />}
          <input name="q" defaultValue={sp.q} placeholder="Name or VAT…" className="h-8 rounded-md border bg-card px-2 text-sm" />
          <input name="tag" defaultValue={sp.tag} placeholder="Tag" className="h-8 w-24 rounded-md border bg-card px-2 text-sm" />
          <button className="h-8 rounded-md border px-2 text-sm">Filter</button>
        </form>
      </div>
      <Card><CardContent className="pt-5">
        <Table data-testid="accounts-table">
          <THead><TR><TH>Company</TH><TH>Type</TH><TH>Manager</TH><TH>Tier · tags</TH><TH className="text-right">Bought 90 d</TH><TH className="text-right">Sold 90 d</TH><TH>Last order</TH><TH>Last contact</TH><TH className="text-right">Open tasks</TH></TR></THead>
          <TBody>
            {rows.map((a) => (
              <TR key={a.id}>
                <TD><Link className="font-medium text-primary hover:underline" href={`/admin/crm/accounts/${a.id}`}>{a.tradeName ?? a.legalName}</Link><div className="text-xs text-muted-foreground">{a.country.flag} {a.legalName}</div></TD>
                <TD>{pretty(a.type)}{a.isInHouse ? " (in-house)" : ""}</TD>
                <TD>{a.crmAccount?.owner?.name ?? <span className="text-muted-foreground">—</span>}</TD>
                <TD>{a.crmAccount?.tier && <Badge>{a.crmAccount.tier}</Badge>} {a.crmAccount?.tags.map((t) => <Badge key={t} variant="secondary" className="mr-1">{t}</Badge>)}</TD>
                <TD className="text-right tabular-nums">{a.type === "DISTRIBUTOR" ? "—" : eur(a.bought90)}</TD>
                <TD className="text-right tabular-nums">{a.type === "CUSTOMER" ? "—" : eur(a.sold90)}</TD>
                <TD className="text-xs">{when(a.lastOrderAt)}</TD>
                <TD className="text-xs">{when(a.lastContactAt)}</TD>
                <TD className="text-right tabular-nums">{a.openTasks || ""}</TD>
              </TR>
            ))}
            {!rows.length && <EmptyRow colSpan={9}>No accounts.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
