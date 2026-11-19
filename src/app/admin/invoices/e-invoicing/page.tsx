import Link from "next/link";
import { FileCode2 } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { einvoiceOverview } from "@/server/einvoice/service";
import { recentPacks } from "@/server/einvoice/monthly";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { EStatus } from "@/components/einvoice/status";
import { RunPacksButton, RunQueueButton } from "@/components/einvoice/admin";
import { FORMAT_LABEL, type EFormat } from "@/lib/einvoice";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "E-Invoicing" };
export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { INVOICE: "Invoice", CREDIT_NOTE: "Credit note", SERVICE_INVOICE: "Service invoice", SELF_BILLED: "Self-billed invoice", SELF_BILLED_CREDIT: "Self-billed credit", SUPPLIER_INVOICE: "Supplier invoice" };
const MODE: Record<string, { label: string; v: "success" | "warning" | "destructive" }> = { live: { label: "Connected", v: "success" }, simulated: { label: "Test network", v: "warning" }, off: { label: "Not connected", v: "destructive" } };

export default async function EInvoicingPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.invoices.view", "admin.tax.manage", "admin.settings.manage"]);
  const [o, packs] = await Promise.all([einvoiceOverview(ctx), recentPacks(ctx)]);
  const manage = can(ctx, ["admin.finance.manage", "admin.settings.manage", "admin.tax.manage"]);
  const count = (dir: string, st: string[]) => o.byStatus.filter((b) => b.direction === dir && st.includes(b.status)).reduce((a, b) => a + b._count._all, 0);
  const tiles = [
    { label: "Sent & accepted (30 days)", v: count("OUTBOUND", ["SENT", "DELIVERED", "ACCEPTED"]), testid: "kpi-sent" },
    { label: "Waiting / queued", v: count("OUTBOUND", ["QUEUED"]), testid: "kpi-queued" },
    { label: "Need attention", v: count("OUTBOUND", ["INVALID", "FAILED", "REJECTED"]), testid: "kpi-attention" },
    { label: "Supplier e-invoices received", v: count("INBOUND", ["RECEIVED", "MATCHED"]), testid: "kpi-inbound" },
  ];
  return (
    <>
      <PageHeader title="E-Invoicing" icon={FileCode2}
        description={<>Every document FIRINGI issues goes out electronically where its recipient&apos;s country route says so (Peppol, KSeF, SDI, Verifactu, XRechnung, Factur-X), checked first, archived with its hash and followed until accepted. Supplier e-invoices come in and are matched. {o.settings.enabled ? "" : <b>E-invoicing is switched off.</b>}</>}
        actions={<div className="flex flex-wrap gap-2">{manage && <RunQueueButton />}<Link href="/admin/invoices/e-invoicing/settings" className="text-sm text-primary hover:underline">Settings</Link><Link href="/admin/invoices/e-invoicing/archive" className="text-sm text-primary hover:underline">Archive</Link><Link href="/admin/invoices/e-invoicing/inbound" className="text-sm text-primary hover:underline">Received</Link></div>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => <Card key={t.label}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{t.label}</p><p className="text-2xl font-semibold tabular-nums" data-testid={t.testid}>{t.v}</p></CardContent></Card>)}
      </div>
      <Card className="mt-4"><CardHeader><CardTitle>Services</CardTitle></CardHeader><CardContent className="overflow-x-auto">
        <Table data-testid="einv-providers">
          <THead><TR><TH>Service</TH><TH>Connection</TH><TH>Used for</TH></TR></THead>
          <TBody>{o.providers.map((p) => (
            <TR key={p.key}><TD className="min-w-0">{p.label}</TD><TD><Badge variant={MODE[p.mode].v}>{MODE[p.mode].label}</Badge></TD><TD className="text-xs">{p.countries.join(", ") || "—"}</TD></TR>
          ))}</TBody>
        </Table>
        <p className="mt-2 text-xs text-muted-foreground">Connect a service with its keys on the server (see docs/e-invoicing.md). &quot;Test network&quot; = the built-in simulator (EINVOICE_SIMULATE=1): nothing reaches a real network.</p>
      </CardContent></Card>
      <Card className="mt-4"><CardHeader><CardTitle>Needs attention</CardTitle></CardHeader><CardContent className="overflow-x-auto">
        <Table data-testid="einv-attention">
          <THead><TR><TH>Document</TH><TH>To / from</TH><TH>Country</TH><TH>Status</TH><TH>Why</TH></TR></THead>
          <TBody>
            {o.attention.length === 0 && <EmptyRow colSpan={5}>Nothing waiting.</EmptyRow>}
            {o.attention.map((d) => (
              <TR key={d.id}>
                <TD><Link className="text-primary hover:underline" href={`/admin/invoices/e-invoicing/${d.id}`}>{d.number}</Link><div className="text-xs text-muted-foreground">{KIND[d.kind]}</div></TD>
                <TD className="min-w-0">{d.counterparty?.legalName ?? "—"}</TD>
                <TD>{d.countryCode}</TD>
                <TD><EStatus status={d.status} /></TD>
                <TD className="min-w-0 max-w-md break-words text-xs">{d.lastError ?? d.responseNote ?? (Array.isArray(d.validation) ? (d.validation as { message: string }[])[0]?.message : "") ?? ""}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent></Card>
      <Card className="mt-4"><CardHeader><CardTitle>Monthly packs for accountants</CardTitle></CardHeader><CardContent className="space-y-3 overflow-x-auto">
        <p className="text-sm text-muted-foreground">{o.settings.monthlyPack.enabled ? `Sent on day ${o.settings.monthlyPack.day} of each month` : "Switched off"} · {packs.withAccountant} compan{packs.withAccountant === 1 ? "y has" : "ies have"} an accountant e-mail.</p>
        {manage && <RunPacksButton />}
        <Table data-testid="packs-recent">
          <THead><TR><TH>Month</TH><TH>Company</TH><TH>Sent to</TH><TH>Documents</TH><TH>Status</TH></TR></THead>
          <TBody>
            {packs.packs.length === 0 && <EmptyRow colSpan={5}>No packs yet.</EmptyRow>}
            {packs.packs.map((p) => (
              <TR key={p.id}><TD>{p.period}</TD><TD className="min-w-0">{p.company.legalName}</TD><TD className="break-all text-xs">{p.sentTo ?? "—"}</TD><TD>{p.documentCount}</TD>
                <TD><Badge variant={p.status === "SENT" ? "success" : p.status === "FAILED" ? "destructive" : "secondary"}>{p.status === "EMPTY" ? "Nothing that month" : p.status.toLowerCase()}</Badge>{p.error && <div className="text-xs text-destructive">{p.error}</div>}</TD></TR>
            ))}
          </TBody>
        </Table>
      </CardContent></Card>
      <Card className="mt-4"><CardHeader><CardTitle>Latest documents</CardTitle></CardHeader><CardContent className="overflow-x-auto">
        <Table data-testid="einv-recent">
          <THead><TR><TH>When</TH><TH>Document</TH><TH>To / from</TH><TH>Format</TH><TH>Status</TH><TH>Network reference</TH></TR></THead>
          <TBody>
            {o.recent.length === 0 && <EmptyRow colSpan={6}>No e-invoices yet.</EmptyRow>}
            {o.recent.map((d) => (
              <TR key={d.id}>
                <TD className="whitespace-nowrap text-xs">{formatDate(d.createdAt, "en-GB", true)}</TD>
                <TD><Link className="text-primary hover:underline" href={`/admin/invoices/e-invoicing/${d.id}`}>{d.number}</Link><div className="text-xs text-muted-foreground">{d.direction === "INBOUND" ? "In · " : ""}{KIND[d.kind]}</div></TD>
                <TD className="min-w-0">{d.counterparty?.legalName ?? "—"}</TD>
                <TD className="text-xs">{FORMAT_LABEL[d.format as EFormat] ?? d.format}</TD>
                <TD><EStatus status={d.status} /></TD>
                <TD className="break-all text-xs">{d.networkRef ?? "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
