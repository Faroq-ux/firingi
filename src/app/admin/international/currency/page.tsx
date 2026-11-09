import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listCurrencies } from "@/server/data/geo";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata = { title: "Currencies" };

export default async function CurrencyPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.international.view", "admin.international.manage", "admin.settings.view"]);
  const rows = await listCurrencies(ctx);
  return (
    <>
      <PageHeader title="Currencies" description="All prices are in EUR at launch. Non-euro EU currencies are ready for distributors pricing in their own currency later." />
      <Table>
        <THead><TR><TH>Code</TH><TH>Name</TH><TH>Symbol</TH><TH>Decimals</TH><TH>Used by</TH></TR></THead>
        <TBody>
          {rows.map((c) => (
            <TR key={c.code}>
              <TD className="font-medium">{c.code} {c.code === "EUR" && <Badge className="ml-1">Default</Badge>}</TD>
              <TD>{c.name}</TD><TD>{c.symbol}</TD><TD>{c.decimals}</TD>
              <TD className="text-muted-foreground">{c._count.countries} countries</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
