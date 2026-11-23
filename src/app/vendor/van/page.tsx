import Link from "next/link";
import { Truck } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { vanOverview } from "@/server/vansales/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewLoadForm } from "@/components/vansales/client";
import { LoadBadge, Tiles } from "@/components/vansales/views";
import { vsLabels } from "@/components/vansales/labels";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Van sales" };
export const dynamic = "force-dynamic";

export default async function VanLoadsPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.vansales.manage");
  const [{ l, locale }, o] = await Promise.all([vsLabels(), vanOverview(ctx)]);
  const m = (n: number) => formatMoney(n, locale);
  const d = (s: string | null) => (s ? new Date(s).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) : "—");
  return (
    <>
      <PageHeader title={l.loadsTitle} description={l.loadsIntro} icon={Truck} />
      {!o.on && <p className="mb-4 rounded-md bg-muted p-3 text-sm" data-testid="vs-off">{l.off}</p>}
      <Tiles items={[
        { label: l.salesToday, value: String(o.today.sales) },
        { label: l.grossToday, value: m(o.today.gross) },
        { label: l.paidToday, value: m(o.today.paid) },
        { label: l.owed, value: m(o.owed), hint: l.owedHint, testid: "vs-owed" },
      ]} />
      {o.on && (
        <Card className="mb-6">
          <CardHeader><CardTitle>{l.newLoad}</CardTitle><CardDescription>{l.newLoadHint}</CardDescription></CardHeader>
          <CardContent><NewLoadForm l={l} warehouses={o.warehouses} sellers={o.sellers} vehicles={o.vehicles} /></CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>{l.loads}</CardTitle></CardHeader>
        <CardContent>
          {!o.loads.length ? <p className="text-sm text-muted-foreground">{l.noLoads}</p> : (
            <ul className="divide-y" data-testid="vl-list">
              {o.loads.map((x) => (
                <li key={x.id} className="space-y-2 py-3" data-testid="vl-row" data-number={x.number}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/vendor/van/${x.id}`} className="font-medium underline-offset-2 hover:underline" data-testid="vl-open">{x.number}</Link>
                    <LoadBadge l={l} status={x.status} />
                    <span className="min-w-0 flex-1 basis-48 text-sm break-words text-muted-foreground">{x.seller} · {x.warehouse}{x.vehicle ? ` · ${x.vehicle}` : ""}</span>
                    <span className="text-xs text-muted-foreground">{d(x.loadedAt ?? x.createdAt)}</span>
                  </div>
                  <dl className="grid grid-cols-3 gap-x-4 gap-y-1 text-sm sm:grid-cols-6">
                    {([[l.units, String(x.units)], [l.sold, String(x.sold)], [l.left, String(x.left)], [l.sales, String(x.sales)], [l.total, m(x.gross)], [l.variance, x.cashVariance == null ? "—" : m(x.cashVariance)]] as const).map(([k, v]) => (
                      <div key={k} className="min-w-0"><dt className="text-xs text-muted-foreground">{k}</dt><dd className={`tabular-nums ${k === l.variance && (x.cashVariance ?? 0) < 0 ? "text-destructive" : ""}`}>{v}</dd></div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
