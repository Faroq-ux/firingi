import Link from "next/link";
import { Scale } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminOverview } from "@/server/catchweight/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Sold by Weight" };
export const dynamic = "force-dynamic";

const kg = (n: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(n);
const pct = (a: number, b: number) => (b > 0 ? `${a >= b ? "+" : ""}${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(((a - b) / b) * 100)} %` : "—");

export default async function AdminCatchWeightPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage"]);
  const v = await adminOverview(ctx);
  const tot = v.suppliers.reduce((a, s) => ({ lines: a.lines + s.lines, weighed: a.weighed + s.weighed, est: a.est + s.estKg, actual: a.actual + s.actualKg, capped: a.capped + s.capped, cappedNet: a.cappedNet + s.cappedNet }), { lines: 0, weighed: 0, est: 0, actual: 0, capped: 0, cappedNet: 0 });
  const tiles = [
    { label: "Products sold by weight", value: String(v.offers) },
    { label: "Delivered lines (90 days)", value: String(tot.lines) },
    { label: "Weighed before delivery", value: tot.lines ? `${Math.round((tot.weighed / tot.lines) * 100)} %` : "—" },
    { label: "Real vs ordered weight", value: pct(tot.actual, tot.est) },
    { label: "Capped at the limit", value: `${tot.capped} · ${new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(tot.cappedNet)}` },
  ];
  return (
    <>
      <PageHeader title="Sold by Weight" icon={Scale} description={`Lines billed on their real weight. Over-weight limit: ${v.settings.maxOverPct.default} % (country exceptions in Settings). Customers pay the real weight; above the limit only if they accept.`} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="cw-tiles">
        {tiles.map((t) => <Card key={t.label}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{t.label}</p><p className="text-xl font-semibold tabular-nums">{t.value}</p></CardContent></Card>)}
      </div>
      <Card className="mb-6">
        <CardHeader><CardTitle>Per supplier (last 90 days)</CardTitle><CardDescription>How close each supplier&apos;s weights are to what customers ordered, and how often the limit capped the bill.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          {!v.suppliers.length ? <p className="py-4 text-center text-sm text-muted-foreground">No delivered sold-by-weight lines yet.</p> : (
            <table className="w-full min-w-[640px] text-sm" data-testid="cw-suppliers">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2">Supplier</th><th>Lines</th><th>Weighed</th><th>Ordered kg</th><th>Real kg</th><th>Billed kg</th><th>Difference</th><th>Above limit</th><th>Capped</th></tr></thead>
              <tbody className="divide-y">
                {v.suppliers.map((s) => (
                  <tr key={s.companyId}><td className="py-2">{s.name}</td><td className="tabular-nums">{s.lines}</td><td className="tabular-nums">{s.weighed}</td><td className="tabular-nums">{kg(s.estKg)}</td><td className="tabular-nums">{kg(s.actualKg)}</td><td className="tabular-nums">{kg(s.billedKg)}</td><td className="tabular-nums">{pct(s.actualKg, s.estKg)}</td><td className="tabular-nums">{s.over}</td><td className="tabular-nums">{s.capped}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Open orders with weights</CardTitle><CardDescription>Confirmed, not yet delivered. FIRINGI staff can weigh on the order page.</CardDescription></CardHeader>
        <CardContent>
          {!v.open.length ? <p className="py-4 text-center text-sm text-muted-foreground">Nothing open.</p> : (
            <ul className="divide-y" data-testid="cw-open">
              {v.open.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <Link href={`/admin/orders/${o.orderId}`} className="font-mono text-xs text-primary hover:underline">{o.number}</Link>
                  <span className="min-w-0 flex-1 basis-48 break-words">{o.product} · {o.supplier} → {o.customer}</span>
                  <span className="tabular-nums">{o.actualKg != null ? `${kg(o.actualKg)} kg` : `≈ ${kg(o.estimatedKg)} kg`}</span>
                  {o.actualKg == null ? <Badge variant="outline">Not weighed</Badge> : o.over ? <Badge variant={o.accepted ? "secondary" : "warning"}>{o.accepted ? "Extra accepted" : "Above limit"}</Badge> : <Badge variant="success">Weighed</Badge>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
