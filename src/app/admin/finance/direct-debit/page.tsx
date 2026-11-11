import { getLocale } from "next-intl/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { RevokeMandate } from "@/components/admin/payments-admin";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { mandatesOverview } from "@/server/payments/admin";
import { paymentPolicy } from "@/server/services/payments";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Direct Debit" };
export const dynamic = "force-dynamic";
const TONE = { ACTIVE: "success", PENDING: "secondary", REVOKED: "outline", FAILED: "destructive" } as const;
const RTONE = { OPEN: "secondary", PROCESSING: "warning", PAID: "success", FAILED: "destructive", EXPIRED: "outline", CANCELLED: "outline" } as const;

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage"]);
  const [{ mandates, collections }, policy, locale] = await Promise.all([mandatesOverview(ctx), paymentPolicy(), getLocale()]);
  const manage = can(ctx, "admin.finance.manage");
  return (
    <>
      <PageHeader title="Direct Debit" description={`Customers who signed a SEPA direct debit mandate have their invoices collected on the due date; they are told ${policy.online.directDebitNoticeDays} days before. FIRINGI keeps only the last 4 digits of the account — the mandate itself is held by the payment provider.`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Mandates</CardTitle></CardHeader><CardContent>
          <Table data-testid="mandates">
            <THead><TR><TH>Customer</TH><TH>Account</TH><TH>State</TH><TH>Signed</TH><TH /></TR></THead>
            <TBody>
              {mandates.map((m) => (
                <TR key={m.id}>
                  <TD>{m.company.legalName}<div className="text-xs text-muted-foreground">{m.holderName ?? ""}{m.autoCollect ? "" : " · automatic collection off"}</div></TD>
                  <TD className="font-mono text-xs">{m.ibanLast4 ? `•••• ${m.ibanLast4}` : "—"}</TD>
                  <TD><Badge variant={TONE[m.status]}>{m.status.toLowerCase()}</Badge>{m.failureReason && <div className="text-xs text-muted-foreground">{m.failureReason}</div>}</TD>
                  <TD className="text-xs">{m.signedAt ? formatDate(m.signedAt, locale) : "—"}</TD>
                  <TD className="text-right">{manage && m.status === "ACTIVE" && <RevokeMandate id={m.id} />}</TD>
                </TR>
              ))}
              {!mandates.length && <EmptyRow colSpan={5}>No direct debit mandates yet.</EmptyRow>}
            </TBody>
          </Table>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Collections</CardTitle></CardHeader><CardContent>
          <Table data-testid="collections">
            <THead><TR><TH>Customer</TH><TH className="text-right">Amount</TH><TH>State</TH><TH>Date</TH></TR></THead>
            <TBody>
              {collections.map((c) => (
                <TR key={c.id}>
                  <TD>{c.company.legalName}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(c.amount.toString(), locale)}</TD>
                  <TD><Badge variant={RTONE[c.status]}>{c.status.toLowerCase()}</Badge>{c.failureReason && <div className="max-w-xs text-xs text-destructive">{c.failureReason}</div>}</TD>
                  <TD className="text-xs">{formatDate(c.createdAt, locale, true)}</TD>
                </TR>
              ))}
              {!collections.length && <EmptyRow colSpan={4}>No collections yet.</EmptyRow>}
            </TBody>
          </Table>
        </CardContent></Card>
      </div>
    </>
  );
}
