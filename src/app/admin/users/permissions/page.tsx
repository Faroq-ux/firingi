import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { ALL_PERMISSION_CODES, AUDIENCES_BY_COMPANY_TYPE, PERMISSIONS } from "@/server/rbac/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata = { title: "Permissions" };

/** Read-only catalogue: permissions are defined in code and synced by the seed. */
export default async function PermissionsPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.users.view", "admin.roles.manage"]);
  const audiences = Object.entries(AUDIENCES_BY_COMPANY_TYPE);
  return (
    <>
      <PageHeader
        title="Permissions"
        description="The permission catalogue is defined in code. Roles combine permissions; a company can only grant the audiences its account type allows."
      />
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {audiences.map(([type, list]) => (
          <span key={type} className="rounded-md border bg-card px-2 py-1"><b>{type}</b>: {list.join(", ")}</span>
        ))}
      </div>
      <Table>
        <THead><TR><TH>Code</TH><TH>Audience</TH><TH>Module</TH><TH>Description</TH></TR></THead>
        <TBody>
          {ALL_PERMISSION_CODES.map((c) => (
            <TR key={c}>
              <TD><code className="text-xs">{c}</code></TD>
              <TD><Badge variant="secondary">{PERMISSIONS[c].audience}</Badge></TD>
              <TD>{PERMISSIONS[c].module}</TD>
              <TD className="text-muted-foreground">{PERMISSIONS[c].description}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
