import Link from "next/link";
import { Inbox } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listDocuments, openStatementsForTest } from "@/server/einvoice/service";
import { simulating } from "@/server/einvoice/providers";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { EStatus } from "@/components/einvoice/status";
import { SimulateInboundForm } from "@/components/einvoice/admin";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Supplier E-Invoices" };
export const dynamic = "force-dynamic";

export default async function InboundPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.invoices.view", "admin.tax.manage", "admin.settings.manage"]);
  const rows = await listDocuments(ctx, { direction: "INBOUND" });
  const sim = simulating() && can(ctx, ["admin.finance.manage", "admin.settings.manage"]);
  const open = sim ? await openStatementsForTest(ctx) : [];
  return (
    <>
      <PageHeader title="Supplier E-Invoices" icon={Inbox} description="Invoices suppliers send through Peppol, KSeF or the EU-wide service. Each is archived, read and matched to its billing statement (by the statement or order number it names, or the one open statement with the same total). Matched ones are recorded as the supplier's invoice; the rest wait here." />
      <Card><CardContent className="overflow-x-auto pt-5">
        <Table data-testid="inbound-rows">
          <THead><TR><TH>Received</TH><TH>Number</TH><TH>Supplier</TH><TH>Total</TH><TH>Status</TH><TH>Result</TH></TR></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={6}>No supplier e-invoices yet.</EmptyRow>}
            {rows.map((d) => {
              const p = (d.parsed ?? {}) as { gross?: number; currency?: string; seller?: { name?: string } };
              return (
                <TR key={d.id}>
                  <TD className="whitespace-nowrap text-xs">{formatDate(d.createdAt, "en-GB", true)}</TD>
                  <TD><Link className="text-primary hover:underline" href={`/admin/invoices/e-invoicing/${d.id}`}>{d.number}</Link></TD>
                  <TD className="min-w-0">{d.counterparty?.legalName ?? p.seller?.name ?? "Unknown"}</TD>
                  <TD className="whitespace-nowrap tabular-nums">{p.gross != null ? formatMoney(String(p.gross), "en-GB", p.currency ?? "EUR") : "—"}</TD>
                  <TD><EStatus status={d.status} /></TD>
                  <TD className="min-w-0 max-w-md break-words text-xs">{d.responseNote ?? (Array.isArray(d.validation) ? (d.validation as { message: string }[])[0]?.message : "") ?? ""}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </CardContent></Card>
      {sim && (
        <Card className="mt-4"><CardHeader><CardTitle>Test network: receive a supplier e-invoice</CardTitle></CardHeader><CardContent>
          <p className="mb-3 text-sm text-muted-foreground">Only with the built-in test network. The supplier&apos;s invoice mirrors the statement; a net difference shows a disputed one.</p>
          <SimulateInboundForm statements={open.map((s) => ({ id: s.id, label: `${s.number} — ${s.vendor.legalName} — ${s.currencyCode !== "EUR" && s.expectedGrossLocal ? `${s.expectedGrossLocal} ${s.currencyCode}` : `${s.expectedGross} €`}` }))} />
        </CardContent></Card>
      )}
    </>
  );
}
