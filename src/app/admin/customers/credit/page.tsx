import Link from "next/link";
import { getLocale } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { balances } from "@/server/services/finance";
import { listCompanies } from "@/server/data/companies";
import { PageHeader } from "@/components/layout/page-header";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CustomerTermsForm } from "@/components/finance/controls";
import { PayFirstToggle } from "@/components/admin/payments-admin";
import { payFirstCompanies } from "@/server/payments/admin";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Credit & Limits" };

export default async function CreditPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.customers.manage", "admin.finance.view"]);
  const [list, b, locale] = await Promise.all([listCompanies(ctx, { types: ["CUSTOMER", "WHOLESALER"], statuses: ["APPROVED"] }), can(ctx, ["admin.finance.view", "admin.finance.manage"]) ? balances(ctx) : null, getLocale()]);
  const open = new Map((b?.receivable ?? []).map((r) => [r.id, r]));
  const payFirst = await payFirstCompanies(list.rows.map((c) => c.id));
  return (
    <>
      <PageHeader title="Credit & Limits" description="Payment terms (days until an invoice is due) and credit limit per buying business. Open balance from unpaid FIRINGI invoices. Pay before shipping: the business's orders wait for its online payment before the supplier sees them." />
      <Table>
        <THead><TR><TH>Business</TH><TH className="text-right">Open</TH><TH className="text-right">Overdue</TH><TH className="text-right">Terms (days) · Credit limit (€)</TH><TH>Pay before shipping</TH></TR></THead>
        <TBody>
          {list.rows.map((c) => (
            <TR key={c.id}>
              <TD><Link className="text-primary hover:underline" href={`/admin/companies/${c.id}`}>{c.legalName}</Link><div className="text-xs text-muted-foreground">{c.type.toLowerCase()}</div></TD>
              <TD className="text-right tabular-nums">{formatMoney(open.get(c.id)?.open ?? 0, locale)}</TD>
              <TD className="text-right tabular-nums">{formatMoney(open.get(c.id)?.overdue ?? 0, locale)}</TD>
              <TD>{can(ctx, "admin.customers.manage") ? <CustomerTermsForm companyId={c.id} days={c.paymentTermsDays} limit={c.creditLimit?.toString() ?? null} /> : `${c.paymentTermsDays} d`}</TD>
              <TD>{can(ctx, ["admin.customers.manage", "admin.finance.manage"]) ? <PayFirstToggle companyId={c.id} on={payFirst.has(c.id)} /> : payFirst.has(c.id) ? "yes" : "no"}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
