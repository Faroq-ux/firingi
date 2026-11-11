import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { SCOPES, apiKeyTargets, listApiKeys } from "@/server/services/api-keys";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CreateApiKeyForm, RevokeApiKeyButton } from "@/components/admin/security-admin-forms";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "API Keys" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage"]);
  const canEdit = can(ctx, "admin.settings.manage");
  const [keys, targets] = await Promise.all([listApiKeys(ctx), canEdit ? apiKeyTargets(ctx) : Promise.resolve([])]);
  return (
    <>
      <PageHeader title="API Keys" description="Keys for suppliers' and buyers' systems (ERP, POS, e-commerce) for API v2. Companies usually create their own (Company › Integrations); here FIRINGI can issue one for a company user. A key acts as that user, limited to its scopes and the user's permissions. Overview: Settings › Integrations." />
      <div className="grid gap-4 lg:grid-cols-2">
        {canEdit && (
          <Card><CardHeader><CardTitle>New key</CardTitle></CardHeader>
            <CardContent><CreateApiKeyForm scopes={Object.entries(SCOPES).map(([key, s]) => ({ key, label: s.label }))}
              targets={targets.map((t) => ({ id: t.id, name: t.tradeName ?? t.legalName, type: t.type, users: t.memberships.map((m) => ({ id: m.user.id, label: `${m.user.name} (${m.user.email})${m.isOwner ? " · owner" : ""}`, owner: m.isOwner })) }))} /></CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle>Using the API</CardTitle><CardDescription>Send the key in the Authorization header. JSON responses; same visibility rules as the portals.</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{`curl -H "Authorization: Bearer fk_live_…" \\
  https://<your FIRINGI address>/api/catalogue/offers?q=mozzarella`}</pre>
            <ul className="list-disc pl-5 text-muted-foreground">
              <li><code>GET /api/catalogue/offers?q=&amp;category=&amp;page=</code> — catalogue (buyers; scope catalogue.read)</li>
              <li><code>GET /api/v1/orders?as=buyer|vendor&amp;since=&amp;page=</code> — orders (scope orders.read)</li>
            </ul>
          </CardContent>
        </Card>
      </div>
      <h2 className="mb-2 mt-6 text-sm font-semibold">Keys</h2>
      <Table>
        <THead><TR><TH>Name</TH><TH>Company · user</TH><TH>Scopes</TH><TH>Key</TH><TH>Last used</TH><TH>Status</TH>{canEdit && <TH />}</TR></THead>
        <TBody>
          {keys.length === 0 && <EmptyRow colSpan={7}>No keys yet.</EmptyRow>}
          {keys.map((k) => (
            <TR key={k.id} data-testid="api-key-row">
              <TD className="font-medium">{k.name}</TD>
              <TD className="text-sm">{k.company.tradeName ?? k.company.legalName}<div className="text-xs text-muted-foreground">{k.user?.email}</div></TD>
              <TD className="text-xs">{k.scopes.join(", ")}</TD>
              <TD className="font-mono text-xs">{k.prefix}…</TD>
              <TD className="text-xs">{k.lastUsedAt ? formatDate(k.lastUsedAt, "en", true) : "never"}</TD>
              <TD>{k.revokedAt ? <Badge variant="secondary">revoked</Badge> : <Badge variant="success">active</Badge>}</TD>
              {canEdit && <TD>{!k.revokedAt && <RevokeApiKeyButton id={k.id} />}</TD>}
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
