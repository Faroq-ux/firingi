import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { FiscalSettingsForm, RetryFiscal, RunFiscalQueue } from "@/components/finance/fiscal-forms";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { fiscalOverview, moloniOptions, vatRatesToMap } from "@/server/invoicing/fiscal";

export const metadata = { title: "Certified Invoicing" };
const MODE = { live: "Connected to Moloni", sandbox: "Connected to Moloni's sandbox (test documents)", simulated: "Simulated Moloni (development — documents are NOT fiscal)", off: "Not connected" } as const;

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.tax.manage", "admin.settings.manage", "admin.invoices.view"]);
  const [o, options, rates] = await Promise.all([
    fiscalOverview(ctx), moloniOptions(ctx),
    vatRatesToMap(ctx),
  ]);
  const canEdit = can(ctx, ["admin.settings.manage", "admin.tax.manage"]);
  const eur = (n: unknown) => new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(Number(n));
  return (
    <>
      <PageHeader title="Certified Invoicing" description="FIRINGI books every invoice and credit note at once; with Moloni switched on, each is then issued at Moloni (AT-certified, communicated to the Tax Authority by Moloni), which gives it its legal number, hash and PDF. If Moloni is unreachable the document waits and is sent again automatically."
        actions={canEdit ? <RunFiscalQueue /> : null} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm" data-testid="moloni-mode">
        <Badge variant={o.mode === "live" ? "success" : o.mode === "off" ? "outline" : "warning"}>{MODE[o.mode]}</Badge>
        <span className="text-muted-foreground">Provider in use: <b>{o.settings.provider === "moloni" ? "Moloni" : "FIRINGI internal (not fiscal)"}</b></span>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="fiscal-kpis">
        <Kpi label="Issued at Moloni" value={o.counts.DONE ?? 0} fmt="number" locale="en" index={0} />
        <Kpi label="Waiting to be sent" value={o.counts.PENDING ?? 0} fmt="number" locale="en" index={1} />
        <Kpi label="Refused / failed" value={o.counts.FAILED ?? 0} fmt="number" locale="en" index={2} />
        <Kpi label="Internal (not fiscal)" value={o.counts.LOCAL ?? 0} fmt="number" locale="en" index={3} />
      </div>
      <Card className="mb-4"><CardHeader><CardTitle>Needs attention</CardTitle></CardHeader><CardContent>
        <Table data-testid="fiscal-problems">
          <THead><TR><TH>Document</TH><TH>Customer</TH><TH className="text-right">Total</TH><TH>State</TH><TH>Moloni says</TH><TH /></TR></THead>
          <TBody>
            {o.problems.map((d) => (
              <TR key={d.id}>
                <TD className="font-mono text-xs"><Link className="text-primary hover:underline" href={`/admin/invoices/${d.id}`}>{d.providerNumber ?? d.fullNumber}</Link>{d.providerNumber && <div className="text-muted-foreground">ref {d.fullNumber}</div>}</TD>
                <TD>{d.recipient.legalName}</TD>
                <TD className="text-right tabular-nums">{eur(d.grossTotal)}</TD>
                <TD><Badge variant={d.fiscalStatus === "FAILED" ? "destructive" : "warning"}>{d.fiscalStatus === "DONE" ? "issued — check" : d.fiscalStatus.toLowerCase()}</Badge>{d.fiscalAttempts > 0 && <div className="text-xs text-muted-foreground">{d.fiscalAttempts} attempt{d.fiscalAttempts > 1 ? "s" : ""}</div>}</TD>
                <TD className="max-w-md text-xs">{d.fiscalError ?? (d.fiscalNextAt ? `next try ${d.fiscalNextAt.toISOString().slice(11, 16)} UTC` : "queued")}</TD>
                <TD>{canEdit && d.fiscalStatus !== "DONE" && <RetryFiscal invoiceId={d.id} />}</TD>
              </TR>
            ))}
            {!o.problems.length && <EmptyRow colSpan={6}>Nothing waiting — every document is where it should be.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
      <Card className="mb-4"><CardHeader><CardTitle>Moloni connection and settings</CardTitle></CardHeader><CardContent>
        <FiscalSettingsForm settings={o.settings} options={options} rates={rates} canEdit={canEdit} />
        <p className="mt-3 text-xs text-muted-foreground">Server keys (never stored in the database): MOLONI_CLIENT_ID, MOLONI_CLIENT_SECRET, MOLONI_USERNAME, MOLONI_PASSWORD; MOLONI_SANDBOX=true for Moloni&apos;s test environment. Customers and products are created at Moloni the first time they are invoiced (by NIF and SKU). With Moloni, Moloni files the SAF-T: FIRINGI&apos;s own SAF-T export is then only for checks.</p>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Last issued at Moloni</CardTitle></CardHeader><CardContent>
        <Table data-testid="fiscal-recent">
          <THead><TR><TH>Moloni number</TH><TH>FIRINGI ref</TH><TH>Customer</TH><TH className="text-right">Total</TH><TH>Issued</TH></TR></THead>
          <TBody>
            {o.recent.map((d) => <TR key={d.id}><TD className="font-mono text-xs">{d.providerNumber}</TD><TD className="font-mono text-xs">{d.fullNumber}</TD><TD>{d.recipient.legalName}</TD><TD className="text-right tabular-nums">{eur(d.grossTotal)}</TD><TD className="text-xs">{d.issuedAt?.toISOString().slice(0, 16).replace("T", " ")}</TD></TR>)}
            {!o.recent.length && <EmptyRow colSpan={5}>No documents issued at Moloni yet.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
