import { ReceiptText } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/utils";
import { adminFiscalQueue } from "@/server/pos/service";
import { RetryButton } from "@/components/pos/forms";

export const metadata = { title: "Till Receipts Queue" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.manage", "admin.finance.view", "admin.finance.manage"]);
  const rows = await adminFiscalQueue(ctx);
  return (
    <>
      <PageHeader title="Till Receipts Queue" icon={ReceiptText} description="Till receipts waiting for, or refused by, the businesses' certified providers (countries on a certified provider). They are retried with back-off; the business is alerted when one fails." />
      <Card><CardContent className="overflow-x-auto pt-5">
        <Table data-testid="pos-fiscal-queue">
          <THead><TR><TH>Sold</TH><TH>Business</TH><TH>Receipt</TH><TH className="text-right">Total</TH><TH>Status</TH><TH>Tries</TH><TH>Why</TH><TH /></TR></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={8}>Nothing waiting.</EmptyRow>}
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="whitespace-nowrap text-xs">{formatDate(r.soldAt, "en-GB", true)}</TD>
                <TD className="min-w-0 break-words">{r.register.company.legalName} <span className="text-xs text-muted-foreground">{r.register.company.country.code}</span></TD>
                <TD>{r.number}</TD><TD className="text-right">{formatMoney(Number(r.gross), "en-GB", r.currency)}</TD>
                <TD><Badge variant={r.fiscalStatus === "FAILED" ? "destructive" : "warning"} className="shrink-0 whitespace-nowrap">{r.fiscalStatus === "FAILED" ? "Failed" : "Waiting"}</Badge></TD>
                <TD>{r.fiscalAttempts}</TD><TD className="min-w-0 max-w-md break-words text-xs">{r.fiscalError ?? "—"}</TD>
                <TD><RetryButton id={r.id} admin /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
