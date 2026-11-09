import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listExchangeRates } from "@/server/data/geo";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Exchange Rates" };

export default async function ExchangeRatesPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.international.view", "admin.international.manage"]);
  const rows = await listExchangeRates(ctx);
  return (
    <>
      <PageHeader title="Exchange Rates" description="Orders store the rate in force when they are placed. Seeded rates are approximate; an ECB daily feed comes later." />
      <Table>
        <THead><TR><TH>Date</TH><TH>Pair</TH><TH className="text-right">Rate</TH><TH>Source</TH></TR></THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={4}>No rates yet.</EmptyRow>}
          {rows.map((r) => (
            <TR key={r.id}>
              <TD>{formatDate(r.date)}</TD>
              <TD className="font-medium">1 {r.baseCode} = {r.quoteCode}</TD>
              <TD className="text-right font-mono">{r.rate.toString()}</TD>
              <TD className="text-muted-foreground">{r.source}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
