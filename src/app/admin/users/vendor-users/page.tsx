import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listVendorUsers } from "@/server/data/users";
import { PageHeader } from "@/components/layout/page-header";
import { AccountStatusBadge } from "@/components/layout/status-badge";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata = { title: "Vendor Users" };

export default async function VendorUsersPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.users.view", "admin.users.manage"]);
  const [rows, tc] = await Promise.all([listVendorUsers(ctx), getTranslations("companyType")]);
  return (
    <>
      <PageHeader title="Vendor Users" description="Users of distributor and wholesaler accounts. Each vendor manages its own users from its portal." />
      <Table>
        <THead><TR><TH>User</TH><TH>Vendor</TH><TH>Type</TH><TH>Account</TH><TH>Roles</TH></TR></THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={5}>No vendor users yet.</EmptyRow>}
          {rows.map((m) => (
            <TR key={m.id}>
              <TD><div className="font-medium">{m.user.name}</div><div className="text-xs text-muted-foreground">{m.user.email}</div></TD>
              <TD>{m.company.country.flag} {m.company.legalName}</TD>
              <TD>{tc(m.company.type)}</TD>
              <TD><AccountStatusBadge status={m.company.status} /></TD>
              <TD><div className="flex flex-wrap gap-1">{m.isOwner && <Badge>Owner</Badge>}{m.roles.map((r) => <Badge key={r.roleId} variant="secondary">{r.role.name}</Badge>)}</div></TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
