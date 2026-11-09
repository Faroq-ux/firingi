import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { invoiceForViewer } from "@/server/services/finance";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CreditNoteForm } from "@/components/finance/controls";
import { formatDate, formatMoney } from "@/lib/utils";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.invoices.view", "admin.finance.view"]);
  const inv = await invoiceForViewer(ctx, (await params).id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const locale = await getLocale();
  const r = inv.recipientSnapshot as { name: string; taxId: string; address?: string };
  return (
    <>
      <Link href="/admin/invoices/customer" className="text-sm text-primary hover:underline">← Invoices</Link>
      <PageHeader title={inv.fullNumber!} description={<span className="flex flex-wrap items-center gap-2"><Badge>{inv.docType.replace("_", " ").toLowerCase()}</Badge><Badge variant="secondary">{inv.status.replace("_", " ").toLowerCase()}</Badge>{formatDate(inv.issuedAt, locale, true)} · ATCUD {inv.atcud} · {inv.externalProvider === "internal" ? "not a fiscal document (test provider)" : inv.externalProvider}</span>}
        actions={<a className="text-sm text-primary hover:underline" href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer">Open PDF</a>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardContent className="pt-5">
          <p className="mb-3 text-sm"><b>{r.name}</b> · NIF {r.taxId} · {r.address}{inv.order && <> · order {inv.order.number}</>}{inv.originalInvoice && <> · credits {inv.originalInvoice.fullNumber}</>}</p>
          <Table>
            <THead><TR><TH>Description</TH><TH className="text-right">Qty</TH><TH className="text-right">Unit</TH><TH className="text-right">VAT</TH><TH className="text-right">Net</TH></TR></THead>
            <TBody>{inv.lines.map((l) => <TR key={l.id}><TD>{l.description}</TD><TD className="text-right tabular-nums">{Number(l.qty)}</TD><TD className="text-right tabular-nums">{formatMoney(l.unitPriceNet.toString(), locale)}</TD><TD className="text-right">{Number(l.taxRate)}%</TD><TD className="text-right tabular-nums">{formatMoney(l.lineNet.toString(), locale)}</TD></TR>)}</TBody>
          </Table>
          <dl className="ml-auto mt-3 grid max-w-xs grid-cols-2 gap-y-1 text-sm">
            <dt>Net</dt><dd className="text-right tabular-nums">{formatMoney(inv.netTotal.toString(), locale)}</dd>
            <dt>VAT</dt><dd className="text-right tabular-nums">{formatMoney(inv.vatTotal.toString(), locale)}</dd>
            <dt className="font-semibold">Total</dt><dd className="text-right font-semibold tabular-nums">{formatMoney(inv.grossTotal.toString(), locale)}</dd>
          </dl>
        </CardContent></Card>
        {inv.docType !== "CREDIT_NOTE" && inv.status !== "CREDITED" && can(ctx, "admin.invoices.issue") && (
          <Card><CardHeader><CardTitle>Issue credit note</CardTitle></CardHeader><CardContent>
            <CreditNoteForm invoiceId={inv.id} lines={inv.lines.map((l) => ({ id: l.id, description: l.description, qty: l.qty.toString() }))} />
          </CardContent></Card>
        )}
      </div>
    </>
  );
}
