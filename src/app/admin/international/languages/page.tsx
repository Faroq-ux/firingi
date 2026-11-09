import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listLanguages } from "@/server/data/geo";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata = { title: "Languages" };

export default async function LanguagesPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.international.view", "admin.international.manage", "admin.settings.view"]);
  const rows = await listLanguages(ctx);
  return (
    <>
      <PageHeader title="Languages" description="Each user can choose their company country's language(s) or English. Languages without a UI translation fall back to English." />
      <Table>
        <THead><TR><TH>Code</TH><TH>Language</TH><TH>Native name</TH><TH>UI translation</TH><TH className="text-right">Countries</TH></TR></THead>
        <TBody>
          {rows.map((l) => (
            <TR key={l.code}>
              <TD><code className="text-xs">{l.code}</code></TD>
              <TD className="font-medium">{l.name}</TD>
              <TD>{l.native}</TD>
              <TD>{l.uiAvailable ? <Badge variant="success">Available</Badge> : <Badge variant="secondary">English fallback</Badge>}</TD>
              <TD className="text-right tabular-nums">{l._count.countries}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
