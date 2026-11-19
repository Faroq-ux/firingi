import Link from "next/link";
import { FileCode2 } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { documentDetail } from "@/server/einvoice/service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EStatus } from "@/components/einvoice/status";
import { CheckButton, ResendButton } from "@/components/einvoice/admin";
import { FORMAT_LABEL, PROVIDER_INFO, type EFormat, type EProvider } from "@/lib/einvoice";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "E-Invoice" };
export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { INVOICE: "Customer invoice", CREDIT_NOTE: "Credit note", SERVICE_INVOICE: "Service invoice", SELF_BILLED: "Self-billed invoice", SELF_BILLED_CREDIT: "Self-billed credit note", SUPPLIER_INVOICE: "Supplier invoice (received)" };

export default async function EInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.invoices.view", "admin.tax.manage", "admin.settings.manage"]);
  const d = await documentDetail(ctx, (await params).id);
  const manage = can(ctx, ["admin.finance.manage", "admin.invoices.issue", "admin.settings.manage", "admin.tax.manage"]);
  const findings = (Array.isArray(d.validation) ? d.validation : []) as { code: string; severity: string; message: string }[];
  const row = (k: string, v: React.ReactNode) => <div className="flex min-w-0 justify-between gap-3 border-b py-1.5 text-sm last:border-0"><span className="shrink-0 text-muted-foreground">{k}</span><span className="min-w-0 break-all text-right">{v}</span></div>;
  return (
    <>
      <PageHeader title={`${d.direction === "INBOUND" ? "Received" : "E-invoice"} ${d.number}`} icon={FileCode2}
        description={<span className="inline-flex flex-wrap items-center gap-2"><EStatus status={d.status} /> {KIND[d.kind]} · {FORMAT_LABEL[d.format as EFormat] ?? d.format}</span>}
        actions={<Link href="/admin/invoices/e-invoicing" className="text-sm text-primary hover:underline">← All e-invoices</Link>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader><CardContent>
          {row("Direction", d.direction === "INBOUND" ? "Received" : "Sent")}
          {row(d.direction === "INBOUND" ? "From" : "To", d.counterparty ? <Link className="text-primary hover:underline" href={`/admin/companies/${d.counterparty.id}`}>{d.counterparty.legalName}</Link> : "—")}
          {row("Country route", d.countryCode)}
          {row("Service", PROVIDER_INFO[d.provider as EProvider]?.label ?? d.provider)}
          {row("Language", d.language ?? "—")}
          {d.invoice && row("FIRINGI document", <Link className="text-primary hover:underline" href={`/admin/invoices/${d.invoice.id}`}>{d.invoice.providerNumber ?? d.invoice.fullNumber}</Link>)}
          {d.statement && row("Statement", d.statement.number)}
          {d.vendorInvoice && row("Supplier invoice", `${d.vendorInvoice.externalNumber} (${d.vendorInvoice.status.toLowerCase()})`)}
          {row("Network reference", <span data-testid="einv-ref">{d.networkRef ?? "—"}</span>)}
          {row("Attempts", d.attempts)}
          {row("Sent", d.sentAt ? formatDate(d.sentAt, "en-GB", true) : "—")}
          {row("Delivered", d.deliveredAt ? formatDate(d.deliveredAt, "en-GB", true) : "—")}
          {row("Answered", d.respondedAt ? formatDate(d.respondedAt, "en-GB", true) : "—")}
          {d.responseNote && row("Answer", d.responseNote)}
          {d.lastError && row("Last error", <span className="text-destructive">{d.lastError}</span>)}
          {row("SHA-256", d.sha256 ? <span className="font-mono text-xs">{d.sha256}</span> : "—")}
          {row("Archive", d.intact == null ? "—" : d.intact ? <Badge variant="success">intact</Badge> : <Badge variant="destructive">hash differs</Badge>)}
          {row("Kept until", d.archiveUntil ? formatDate(d.archiveUntil, "en-GB") : "—")}
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            {d.xmlKey && <a className="text-primary hover:underline" href={`/api/einvoice/${d.id}/xml`} data-testid="einv-xml">Download XML</a>}
            {d.pdfKey && <a className="text-primary hover:underline" href={`/api/einvoice/${d.id}/pdf`}>Download PDF</a>}
          </div>
        </CardContent></Card>
        <div className="space-y-4">
          {d.direction === "OUTBOUND" && manage && (
            <Card><CardHeader><CardTitle>Actions</CardTitle></CardHeader><CardContent className="space-y-3">
              <CheckButton id={d.id} />
              {["INVALID", "FAILED", "REJECTED", "QUEUED"].includes(d.status) && <ResendButton id={d.id} />}
            </CardContent></Card>
          )}
          <Card><CardHeader><CardTitle>Checks</CardTitle></CardHeader><CardContent>
            {findings.length === 0 ? <p className="text-sm text-muted-foreground">No problems were found when it was checked.</p>
              : <ul className="space-y-1 text-sm" data-testid="einv-findings">{findings.map((f, i) => <li key={i} className={f.severity === "error" ? "text-destructive" : "text-amber-700 dark:text-warning"}><b>{f.code}</b> — {f.message}</li>)}</ul>}
          </CardContent></Card>
          <Card><CardHeader><CardTitle>History</CardTitle></CardHeader><CardContent>
            <ol className="space-y-2 text-sm" data-testid="einv-events">
              {d.events.map((e) => <li key={e.id} className="flex min-w-0 gap-2"><span className="shrink-0 text-xs text-muted-foreground">{formatDate(e.at, "en-GB", true)}</span><EStatus status={e.status} /><span className="min-w-0 break-words">{e.message}</span></li>)}
            </ol>
          </CardContent></Card>
        </div>
      </div>
      {d.xml && (
        <Card className="mt-4"><CardHeader><CardTitle>XML</CardTitle></CardHeader><CardContent>
          <pre className="max-h-[32rem] overflow-auto rounded-md bg-muted p-3 text-xs" data-testid="einv-xml-preview">{d.xml.slice(0, 60_000)}</pre>
        </CardContent></Card>
      )}
    </>
  );
}
