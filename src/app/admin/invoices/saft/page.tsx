import { Download } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { saftOverview } from "@/server/invoicing/saft";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "SAF-T / Compliance" };

const lastMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

export default async function Page({ searchParams }: { searchParams: Promise<{ month?: string; entity?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.tax.manage", "admin.invoices.view"]);
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : lastMonth();
  const o = await saftOverview(ctx, month, sp.entity);
  return (
    <>
      <PageHeader title="SAF-T / Compliance" description="Monthly SAF-T (PT) file of FIRINGI's invoices and credit notes, for the Tax Authority (e-Fatura) — submit by the legal deadline (currently the 5th of the following month). Check the series before submitting." />
      {!o.certified && (
        <p className="mb-4 rounded-md border border-warning/60 bg-warning/10 p-3 text-sm" role="alert" data-testid="not-certified">
          <b>Not for real invoicing yet.</b> Documents are issued by FIRINGI&apos;s internal development provider, which is not AT-certified (documents say &quot;not a fiscal document&quot;). Connect a certified invoicing provider before go-live; SAF-T then carries its certificate number and signatures.
        </p>
      )}
      <form className="mb-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-muted-foreground">Legal entity
          <select name="entity" defaultValue={o.entity?.id} className="h-9 rounded-md border bg-card px-2 text-sm">{o.entities.map((e) => <option key={e.id} value={e.id}>{e.legalName} ({e.taxId})</option>)}</select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">Month
          <input type="month" name="month" defaultValue={month} className="h-9 rounded-md border bg-card px-2 text-sm" />
        </label>
        <button className="h-9 rounded-md border bg-card px-3 text-sm">Show</button>
      </form>
      {!o.entity ? <p className="text-sm text-muted-foreground">No Portuguese legal entity is set up (Settings › Invoice Settings).</p> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader><CardTitle>{month}</CardTitle><CardDescription>{o.entity.legalName}</CardDescription></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <dl className="grid grid-cols-2 gap-y-1">
                <dt className="text-muted-foreground">Documents</dt><dd className="text-right tabular-nums" data-testid="saft-documents">{o.totals!.documents}</dd>
                <dt className="text-muted-foreground">Invoices</dt><dd className="text-right tabular-nums">{o.totals!.invoices}</dd>
                <dt className="text-muted-foreground">Credit notes</dt><dd className="text-right tabular-nums">{o.totals!.creditNotes}</dd>
                <dt className="text-muted-foreground">Total credit (net)</dt><dd className="text-right tabular-nums">{formatMoney(o.totals!.credit)}</dd>
                <dt className="text-muted-foreground">Total debit (net)</dt><dd className="text-right tabular-nums">{formatMoney(o.totals!.debit)}</dd>
              </dl>
              {/* Plain link: a Next <Link> would prefetch (= build + audit) the file on every view. */}
              <a className={buttonVariants({ className: "w-full" })} href={`/api/saft?entity=${o.entity.id}&month=${month}`} data-testid="saft-download"><Download className="h-4 w-4" />Download SAF-T (XML)</a>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Series check</CardTitle><CardDescription>Numbering without gaps, unbroken hash chain, ATCUD on every document, series communicated to AT.</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <THead><TR><TH>Series</TH><TH>Type</TH><TH>AT validation code</TH><TH className="text-right">Documents</TH><TH>Status</TH></TR></THead>
                <TBody>
                  {o.series.length === 0 && <EmptyRow colSpan={5}>No series yet.</EmptyRow>}
                  {o.series.map((s) => (
                    <TR key={s.id} data-testid="series-row">
                      <TD className="font-medium">{s.name}</TD><TD>{s.docType.toLowerCase().replace("_", " ")}</TD>
                      <TD className="font-mono text-xs">{s.validationCode ?? "—"}</TD><TD className="text-right tabular-nums">{s.documents}</TD>
                      <TD>{s.ok ? <Badge variant="success">OK</Badge> : <><Badge variant="destructive">Check</Badge><ul className="mt-1 text-xs text-destructive">{s.problems.map((p) => <li key={p}>{p}</li>)}</ul></>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
