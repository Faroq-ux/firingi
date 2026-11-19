import Link from "next/link";
import { Archive } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listDocuments } from "@/server/einvoice/service";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { EStatus, STATUS_EN } from "@/components/einvoice/status";
import { VerifyArchiveButton } from "@/components/einvoice/admin";
import { FORMAT_LABEL, SCHENGEN, type EFormat } from "@/lib/einvoice";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "E-Invoice Archive" };
export const dynamic = "force-dynamic";

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function EInvoiceArchivePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.invoices.view", "admin.tax.manage", "admin.settings.manage"]);
  const sp = await searchParams;
  const from = sp.from ? new Date(sp.from) : new Date(Date.now() - 31 * 86400_000);
  const to = sp.to ? new Date(`${sp.to}T23:59:59Z`) : new Date();
  const rows = await listDocuments(ctx, {
    direction: sp.dir === "OUTBOUND" || sp.dir === "INBOUND" ? sp.dir : undefined, status: sp.status || undefined, country: sp.country || undefined, q: sp.q || undefined, from, to,
  });
  const exportHref = `/api/admin/einvoice/export?from=${day(from)}&to=${day(to)}${sp.country ? `&country=${sp.country}` : ""}`;
  return (
    <>
      <PageHeader title="E-Invoice Archive" icon={Archive} description="Every e-invoice sent and received, kept with the SHA-256 hash it was archived with, for each country's legal period. Export a period for the auditor (XML, PDF and a manifest)." />
      <Card><CardContent className="pt-5">
        <form className="grid gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(6,minmax(0,1fr))_auto] lg:items-end" data-testid="archive-filter">
          <div className="space-y-1"><Label htmlFor="a-from">From</Label><Input id="a-from" type="date" name="from" defaultValue={day(from)} /></div>
          <div className="space-y-1"><Label htmlFor="a-to">To</Label><Input id="a-to" type="date" name="to" defaultValue={day(to)} /></div>
          <div className="space-y-1"><Label htmlFor="a-dir">Direction</Label><Select id="a-dir" name="dir" defaultValue={sp.dir ?? ""}><option value="">Both</option><option value="OUTBOUND">Sent</option><option value="INBOUND">Received</option></Select></div>
          <div className="space-y-1"><Label htmlFor="a-st">Status</Label><Select id="a-st" name="status" defaultValue={sp.status ?? ""}><option value="">Any</option>{Object.entries(STATUS_EN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
          <div className="space-y-1"><Label htmlFor="a-c">Country</Label><Select id="a-c" name="country" defaultValue={sp.country ?? ""}><option value="">All</option>{SCHENGEN.map((c) => <option key={c}>{c}</option>)}</Select></div>
          <div className="space-y-1"><Label htmlFor="a-q">Search</Label><Input id="a-q" name="q" defaultValue={sp.q ?? ""} placeholder="Number, reference, company" /></div>
          <Button type="submit" variant="outline">Show</Button>
        </form>
        <div className="mt-4 flex flex-wrap items-start gap-4">
          <a href={exportHref} className="inline-flex h-9 items-center rounded-lg border px-3 text-sm font-medium hover:bg-accent" data-testid="archive-export">Auditor export (ZIP)</a>
          <VerifyArchiveButton />
        </div>
      </CardContent></Card>
      <Card className="mt-4"><CardHeader><CardTitle>{rows.length} document{rows.length === 1 ? "" : "s"}</CardTitle></CardHeader><CardContent className="overflow-x-auto">
        <Table data-testid="archive-rows">
          <THead><TR><TH>When</TH><TH>Document</TH><TH>Company</TH><TH>Country</TH><TH>Format</TH><TH>Status</TH><TH>Network reference</TH><TH>Kept until</TH></TR></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={8}>Nothing in this period.</EmptyRow>}
            {rows.map((d) => (
              <TR key={d.id}>
                <TD className="whitespace-nowrap text-xs">{formatDate(d.createdAt, "en-GB", true)}</TD>
                <TD><Link className="text-primary hover:underline" href={`/admin/invoices/e-invoicing/${d.id}`}>{d.number}</Link><div className="text-xs text-muted-foreground">{d.direction === "INBOUND" ? "Received" : "Sent"}</div></TD>
                <TD className="min-w-0">{d.counterparty?.legalName ?? "—"}</TD>
                <TD>{d.countryCode}</TD>
                <TD className="text-xs">{FORMAT_LABEL[d.format as EFormat] ?? d.format}</TD>
                <TD><EStatus status={d.status} /></TD>
                <TD className="break-all text-xs">{d.networkRef ?? "—"}</TD>
                <TD className="whitespace-nowrap text-xs">{d.archiveUntil ? formatDate(d.archiveUntil, "en-GB") : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
