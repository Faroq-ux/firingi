import { Boxes } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminOverview } from "@/server/consignment/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminConsignmentSettings, DecideSite, RetryCount, SwitchOffVendor, VendorSwitch } from "@/components/consignment/client";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Consignment stock" };
export const dynamic = "force-dynamic";

const CHANNEL = { DISTRIBUTOR_WHOLESALER: "Distributor → wholesaler", WHOLESALER_CUSTOMER: "Wholesaler → shop" } as const;
const COUNTER = { CUSTOMER: "customer counts", SUPPLIER: "supplier counts", EITHER: "either counts" } as const;
const STATUS = { ACTIVE: "success", PENDING: "warning", REJECTED: "destructive", CLOSED: "secondary" } as const;

export default async function AdminConsignmentPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.settings.manage"]);
  const o = await adminOverview(ctx);
  const en = "en-GB";
  return (
    <>
      <PageHeader title="Consignment stock" icon={Boxes}
        description="Suppliers leave stock at customers (distributors with wholesalers, wholesalers with shops and restaurants). Customers pay only for what they use: each confirmed count becomes an order FIRINGI invoices to the customer." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="csa-tiles">
        {([["Active sites", o.kpis.sites], ["Waiting for approval", o.kpis.pending], ["Stock at customers (cost)", formatMoney(o.kpis.value, en)], ["Invoiced (30 days)", `${formatMoney(o.kpis.billed30, en)} · ${o.kpis.counts30}`], ["Disputes & failures", o.kpis.disputes]] as const).map(([k, v]) => (
          <div key={k} className="rounded-2xl border bg-card p-4"><p className="text-xs text-muted-foreground">{k}</p><p className="text-lg font-semibold tabular-nums">{v}</p></div>
        ))}
      </div>
      <Card className="mb-6">
        <CardHeader><CardTitle>Waiting for approval</CardTitle><CardDescription>No stock can be sent until FIRINGI approves the consignment.</CardDescription></CardHeader>
        <CardContent>
          {!o.pending.length ? <p className="text-sm text-muted-foreground" data-testid="csa-no-pending">Nothing to approve.</p> : (
            <ul className="divide-y" data-testid="csa-pending">
              {o.pending.map((p) => (
                <li key={p.id} className="space-y-2 py-3 text-sm" data-testid="csa-pending-row" data-id={p.id}>
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{p.number}</span><Badge variant="secondary">{CHANNEL[p.channel]}</Badge><span className="text-muted-foreground">{formatDate(p.at, en, true)}</span></div>
                  <p className="break-words"><b>{p.supplier}</b> → <b>{p.customer}</b> · {p.address}</p>
                  <p className="text-xs text-muted-foreground">Count every {p.every} days · {COUNTER[p.counter]}{p.note ? ` · ${p.note}` : ""}</p>
                  <DecideSite id={p.id} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {(o.disputes.length > 0 || o.failed.length > 0) && (
        <Card className="mb-6">
          <CardHeader><CardTitle>Disputes & failed billing</CardTitle><CardDescription>A disputed count is settled by a recount; a failed one can be billed again.</CardDescription></CardHeader>
          <CardContent>
            <ul className="divide-y" data-testid="csa-issues">
              {[...o.disputes.map((x) => ({ ...x, kind: "Disputed" as const })), ...o.failed.map((x) => ({ ...x, kind: "Billing failed" as const }))].map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <Badge variant="destructive">{x.kind}</Badge><span className="font-medium">{x.number}</span><span className="text-muted-foreground">{x.site} · {x.supplier} → {x.customer}</span>
                  {x.note && <span className="min-w-0 basis-full break-words text-xs">{x.note}</span>}
                  {x.kind === "Billing failed" && <RetryCount l={{ retry: "Bill again" }} id={x.id} />}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card className="mb-6">
        <CardHeader><CardTitle>Settings</CardTitle><CardDescription>Switch consignment and each channel on or off, approval, who may count, automatic confirmation and expiry alerts.</CardDescription></CardHeader>
        <CardContent><AdminConsignmentSettings settings={o.settings} /></CardContent>
      </Card>
      <Card className="mb-6">
        <CardHeader><CardTitle>Suppliers</CardTitle><CardDescription>Stock each supplier has at customers, and the switch per supplier.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {!o.suppliers.length ? <p className="text-sm text-muted-foreground">No supplier has consignment stock yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm" data-testid="csa-suppliers">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-2">Supplier</th><th className="px-2 text-right">Sites</th><th className="px-2 text-right">Units</th><th className="px-2 text-right">Value at cost</th><th /></tr></thead>
                <tbody>{o.suppliers.map((s) => (
                  <tr key={s.id} className="border-b last:border-0" data-testid="csa-supplier"><td className="py-2 pr-2 font-medium">{s.name}</td><td className="px-2 text-right tabular-nums">{s.sites}</td><td className="px-2 text-right tabular-nums">{s.units}</td><td className="px-2 text-right tabular-nums">{formatMoney(s.value, en)}</td><td className="px-2 text-right"><VendorSwitch vendorId={s.id} on={s.on} /></td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {o.disabled.length > 0 && (
            <div className="space-y-2"><p className="text-sm font-medium">Switched off for</p>
              <ul className="divide-y rounded-md border" data-testid="csa-disabled">{o.disabled.map((v) => <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm"><span className="min-w-0 break-words">{v.name}</span><VendorSwitch vendorId={v.id} on={false} /></li>)}</ul>
            </div>
          )}
          <div className="space-y-2"><p className="text-sm font-medium">Switch off for a supplier</p><SwitchOffVendor /></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>All sites</CardTitle></CardHeader>
        <CardContent>
          {!o.sites.length ? <p className="text-sm text-muted-foreground">No consignment yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm" data-testid="csa-sites">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-2">Site</th><th className="px-2">Channel</th><th className="px-2">Supplier → customer</th><th className="px-2">Status</th><th className="px-2 text-right">Units</th><th className="px-2 text-right">Value</th><th className="px-2">Last count</th></tr></thead>
                <tbody>{o.sites.map((x) => (
                  <tr key={x.id} className="border-b last:border-0" data-testid="csa-site" data-status={x.status}>
                    <td className="py-2 pr-2 font-medium">{x.number}</td><td className="px-2 text-xs">{CHANNEL[x.channel]}</td><td className="px-2">{x.supplier} → {x.customer}</td>
                    <td className="px-2"><Badge variant={STATUS[x.status]}>{x.status.toLowerCase()}</Badge>{x.overdue && <Badge variant="destructive" className="ml-1">count overdue</Badge>}</td>
                    <td className="px-2 text-right tabular-nums">{x.units}</td><td className="px-2 text-right tabular-nums">{formatMoney(x.value, en)}</td><td className="px-2">{x.lastCountAt ? formatDate(x.lastCountAt, en) : "never"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
