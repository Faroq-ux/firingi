import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { securityOverview, securityPolicy } from "@/server/services/security";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { SecurityPolicyForm, UserSecurityActions } from "@/components/admin/security-admin-forms";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Security" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage"]);
  const [policy, users] = await Promise.all([securityPolicy(), securityOverview(ctx)]);
  const canEdit = can(ctx, "admin.settings.manage");
  const staff = users.filter((u) => u.group === "FIRINGI staff");
  const withTwoFactor = staff.filter((u) => u.twoFactor).length;
  return (
    <>
      <PageHeader title="Security" description="Two-factor login, session length and who is signed in. Passwords: at least 10 characters; sign-in attempts are rate-limited; disabled users lose access immediately." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1"><CardHeader><CardTitle>Policy</CardTitle></CardHeader><CardContent><SecurityPolicyForm policy={policy} canEdit={canEdit} /></CardContent></Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Staff and company owners</CardTitle><p className="text-sm text-muted-foreground">{withTwoFactor} of {staff.length} FIRINGI staff use two-factor login.</p></CardHeader>
          <CardContent>
            <Table>
              <THead><TR><TH>User</TH><TH>Group</TH><TH>Two-factor</TH><TH>Last login</TH><TH className="text-right">Sessions</TH>{canEdit && <TH />}</TR></THead>
              <TBody>
                {users.length === 0 && <EmptyRow colSpan={6}>No users.</EmptyRow>}
                {users.map((u) => (
                  <TR key={u.id} data-testid="security-user">
                    <TD><div className="font-medium">{u.name}</div><div className="text-xs text-muted-foreground">{u.email}{u.group !== "FIRINGI staff" && ` · ${u.companies}`}</div></TD>
                    <TD className="text-sm">{u.group}{u.driver && <span className="text-xs text-muted-foreground"> · driver</span>}</TD>
                    <TD>{u.twoFactor ? <Badge variant="success">On</Badge> : <Badge variant="secondary">Off</Badge>}</TD>
                    <TD className="text-xs">{u.lastLoginAt ? formatDate(u.lastLoginAt, "en", true) : "—"}</TD>
                    <TD className="text-right tabular-nums">{u.sessions}</TD>
                    {canEdit && <TD><UserSecurityActions userId={u.id} twoFactor={u.twoFactor} canReset={u.id !== ctx.user.id} /></TD>}
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
