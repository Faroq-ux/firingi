import Link from "next/link";
import { Calculator } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { adminPosOverview } from "@/server/pos/service";
import { CountUp } from "@/components/motion/count-up";

export const metadata = { title: "Till Overview" };
export const dynamic = "force-dynamic";

const TYPE = { DISTRIBUTOR: "Distributors", WHOLESALER: "Wholesalers", CUSTOMER: "Wholesale customers" } as Record<string, string>;

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.manage", "admin.vendors.view", "admin.customers.view", "admin.finance.view"]);
  const o = await adminPosOverview(ctx);
  const provider = Object.entries(o.settings.countries).filter(([, c]) => c.enabled && c.stage === "PROVIDER").map(([cc]) => cc);
  const kpi = (label: string, value: string | number, id: string, i = 0) => <div className="motion-rise motion-lift" style={{ ["--i" as string]: i } as React.CSSProperties}><Card className="h-full"><CardContent className="pt-5"><div className="text-xs text-muted-foreground">{label}</div><div className="text-2xl font-semibold" data-testid={id}>{typeof value === "number" ? <CountUp value={value} fmt="int" locale="en-GB" /> : value}</div></CardContent></Card></div>;
  return (
    <>
      <PageHeader title="Till Overview" icon={Calculator} description="Suppliers' counters and customers' own shops and restaurants selling at FIRINGI's till. Their sales are their own (they issue the receipts); FIRINGI keeps the till, stock, reports and accounting." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpi("Till", o.settings.enabled ? "On" : "Off", "apos-enabled")}{kpi("Tills set up", o.registers, "apos-registers", 1)}{kpi("Sales (30 days)", o.sales30, "apos-sales", 2)}{kpi("Receipts waiting / failed", `${o.pending} / ${o.failed}`, "apos-fiscal")}{kpi("Extra tills to approve", o.tillRequests, "apos-till-requests")}
      </div>
      <Card className="mb-4"><CardHeader><CardTitle>By company type</CardTitle></CardHeader><CardContent className="overflow-x-auto">
        <Table data-testid="apos-types"><THead><TR><TH>Type</TH><TH>Switch</TH><TH className="text-right">Companies</TH><TH className="text-right">Till allowed</TH><TH className="text-right">Selling (30 days)</TH></TR></THead>
          <TBody>{Object.entries(TYPE).map(([k, label]) => <TR key={k}><TD>{label}</TD><TD>{o.settings.types[k as "CUSTOMER"] ? "On" : "Off"}</TD><TD className="text-right">{o.byType[k]?.total ?? 0}</TD><TD className="text-right">{o.byType[k]?.allowed ?? 0}</TD><TD className="text-right">{o.byType[k]?.using ?? 0}</TD></TR>)}</TBody></Table>
      </CardContent></Card>
      <Card><CardContent className="space-y-1 pt-5 text-sm">
        <p>Countries on a certified provider: <b data-testid="apos-provider-countries">{provider.length ? provider.join(", ") : "none (all non-fiscal)"}</b>. Businesses connected to a provider: {o.connected}.</p>
        <p className="flex flex-wrap gap-3"><Link className="text-primary hover:underline" href="/admin/pos/settings">Till Settings</Link><Link className="text-primary hover:underline" href="/admin/pos/companies">Till per Company</Link><Link className="text-primary hover:underline" href="/admin/pos/fiscal">Receipts Queue</Link></p>
      </CardContent></Card>
    </>
  );
}
