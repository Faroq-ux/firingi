import Link from "next/link";
import { Boxes } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { consignmentSettings, vendorOverview } from "@/server/consignment/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewSite } from "@/components/consignment/client";
import { SiteStatus } from "@/components/consignment/views";
import { csLabels, fill } from "@/components/consignment/labels";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Consignment stock" };
export const dynamic = "force-dynamic";

export default async function VendorConsignmentPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.consignment.manage", "vendor.consignment.count"]);
  const [{ l, locale }, o, s] = await Promise.all([csLabels(), vendorOverview(ctx), consignmentSettings()]);
  return (
    <>
      <PageHeader title={l.title} description={l.intro} icon={Boxes} />
      {!o.on && <p className="mb-6 rounded-xl border border-dashed p-3 text-sm" data-testid="cs-off">{l.off}</p>}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="cs-tiles">
        {([[l["kpi.sites"], o.kpis.sites], [l["kpi.units"], o.kpis.units], [l["kpi.value"], formatMoney(o.kpis.value, locale)], [l["kpi.toConfirm"], o.kpis.toConfirm]] as const).map(([k, v]) => (
          <div key={k} className="rounded-2xl border bg-card p-4"><p className="text-xs text-muted-foreground">{k}</p><p className="text-lg font-semibold tabular-nums">{v}</p></div>
        ))}
      </div>
      <Card className="mb-6">
        <CardHeader><CardTitle>{l.sites}</CardTitle></CardHeader>
        <CardContent>
          {!o.sites.length ? <p className="text-sm text-muted-foreground" data-testid="cs-no-sites">{l.noSites}</p> : (
            <ul className="divide-y" data-testid="cs-sites">
              {o.sites.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2 py-3 text-sm" data-testid="cs-site-row" data-id={x.id} data-status={x.status}>
                  <Link href={`/vendor/consignment/${x.id}`} className="min-w-0 flex-1 basis-48 break-words font-medium underline-offset-2 hover:underline">{x.customer} <span className="text-xs font-normal text-muted-foreground">· {x.number}</span></Link>
                  <SiteStatus l={l} status={x.status} />
                  {x.status === "ACTIVE" && <span className="tabular-nums">{l.onShelf}: {x.units} · {formatMoney(x.value, locale)}</span>}
                  {x.inTransit > 0 && <Badge variant="secondary">{l.inTransit}</Badge>}
                  {x.toConfirm > 0 && <Badge variant="warning">{fill(l.toConfirm, { n: x.toConfirm })}</Badge>}
                  {x.disputed > 0 && <Badge variant="destructive">{fill(l.disputed, { n: x.disputed })}</Badge>}
                  {x.overdue && <Badge variant="destructive">{l.overdue}</Badge>}
                  <span className="text-xs text-muted-foreground">{l.lastCount}: {x.lastCountAt ? formatDate(x.lastCountAt, locale) : l.never}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {o.manage && o.on && (
        <Card>
          <CardHeader><CardTitle>{l.newSite}</CardTitle></CardHeader>
          <CardContent><NewSite l={l} warehouses={o.warehouses} every={o.defaultEvery} approval={s.requireApproval} /></CardContent>
        </Card>
      )}
    </>
  );
}
