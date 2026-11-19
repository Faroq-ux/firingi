import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { exciseOverview, exciseReport } from "@/server/excise/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExciseReportView } from "@/components/excise/views";
import { enLabels } from "@/components/excise/labels";

export const metadata = { title: "Excise" };
export const dynamic = "force-dynamic";

const months = () => [0, 1, 2, 3, 4, 5].map((k) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 7); });

export default async function AdminExcisePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage"]);
  const ms = months();
  const month = ms.includes((await searchParams).month ?? "") ? (await searchParams).month! : ms[0];
  const [ov, r] = await Promise.all([exciseOverview(ctx).catch(() => null), exciseReport(ctx, month, "en")]);
  const tiles = ov ? [
    { label: "Licences to review", value: ov.pending, href: "/admin/customers/licences?status=PENDING" },
    { label: "Licences ending in 30 days", value: ov.expiring, href: "/admin/customers/licences?status=APPROVED" },
    { label: "Products missing measures", value: ov.incompleteCount, href: "#incomplete" },
    { label: `Duty this month (added / in prices)`, value: `${r.totals.dutyAdded.toFixed(2).replace(".", ",")} € / ${r.totals.dutyIncluded.toFixed(2).replace(".", ",")} €`, href: "#report" },
  ] : [];
  return (
    <>
      <PageHeader title="Excise" icon={FileSpreadsheet} description="Licensed goods delivered per month — quantities, litres of pure alcohol, pieces, kg, duty added by FIRINGI and duty in suppliers' prices — and what needs attention." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="ex-tiles">
        {tiles.map((t) => <Link key={t.label} href={t.href}><Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{t.label}</p><p className="text-xl font-semibold tabular-nums">{t.value}</p></CardContent></Card></Link>)}
      </div>
      <Card className="mb-6" id="report"><CardContent className="pt-5"><ExciseReportView r={r} l={enLabels()} locale="en" months={ms} base="/admin/finance/excise" /></CardContent></Card>
      {ov && ov.incomplete.length > 0 && (
        <Card id="incomplete">
          <CardHeader><CardTitle>Products missing measures</CardTitle><CardDescription>No duty can be calculated until the supplier adds them.</CardDescription></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" data-testid="ex-incomplete">
              {ov.incomplete.map((o) => <li key={o.offerId} className="flex flex-wrap gap-2 py-1.5"><span className="min-w-0 flex-1 basis-48 break-words">{o.supplier}</span><span className="font-mono text-xs">{o.sku}</span><span>{o.category}</span><span className="text-destructive">{o.missing.join(", ")}</span></li>)}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
