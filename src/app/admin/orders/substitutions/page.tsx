import Link from "next/link";
import { Repeat } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminOverview, substitutionSettings } from "@/server/substitutions/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminSettingsForm } from "@/components/substitutions/client";

export const metadata = { title: "Substitutions" };
export const dynamic = "force-dynamic";

const STATUS = ["PENDING", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"] as const;
const LABEL: Record<string, string> = { PENDING: "Waiting", ACCEPTED: "Accepted", REJECTED: "Rejected", EXPIRED: "Not answered", CANCELLED: "Withdrawn" };
const TONE: Record<string, "success" | "warning" | "secondary" | "outline"> = { PENDING: "warning", ACCEPTED: "success", REJECTED: "secondary", EXPIRED: "outline", CANCELLED: "outline" };
const pct = (n: number) => `${n > 0 ? "+" : ""}${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(n)} %`;

export default async function AdminSubstitutionsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage"]);
  const { status } = await searchParams;
  const [v, s] = await Promise.all([adminOverview(ctx, { status: status ?? null, days: 30 }), substitutionSettings()]);
  const t = v.totals;
  const tiles = [
    { label: "Proposed (30 days)", value: String(t.proposed) },
    { label: "Waiting for customers", value: String(t.pending) },
    { label: "Accepted", value: `${t.accepted}${t.auto ? ` (${t.auto} automatic)` : ""}` },
    { label: "Rejected / not answered", value: `${t.rejected} / ${t.expired}` },
    { label: "Acceptance rate", value: t.acceptRate == null ? "—" : `${t.acceptRate} %` },
  ];
  const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" });
  return (
    <>
      <PageHeader title="Substitutions" icon={Repeat} description="Replacements suppliers offer for products they can't deliver. Customers choose never / ask / automatic within a price limit (also per product). Accepted replacements become order lines at the customer's price; FIRINGI invoices them at delivery." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="sub-tiles">
        {tiles.map((x) => <Card key={x.label}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{x.label}</p><p className="text-xl font-semibold tabular-nums">{x.value}</p></CardContent></Card>)}
      </div>
      <Card className="mb-6">
        <CardHeader><CardTitle>Settings</CardTitle><CardDescription>Switch substitutions on or off for everyone, and set the defaults for customers who haven&apos;t chosen.</CardDescription></CardHeader>
        <CardContent>{ctx.permissions.has("admin.settings.manage") ? <AdminSettingsForm s={s} /> : <p className="text-sm text-muted-foreground">You can view, not change, these settings.</p>}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Replacements (last 30 days)</CardTitle>
          <div className="flex flex-wrap gap-2 pt-1 text-xs">
            <Link href="/admin/orders/substitutions" className={!status ? "font-semibold text-primary" : "text-muted-foreground hover:underline"}>All</Link>
            {STATUS.map((x) => <Link key={x} href={`/admin/orders/substitutions?status=${x}`} className={status === x ? "font-semibold text-primary" : "text-muted-foreground hover:underline"}>{LABEL[x]}</Link>)}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!v.items.length ? <p className="py-4 text-center text-sm text-muted-foreground">No replacements yet.</p> : (
            <table className="w-full min-w-[760px] text-sm" data-testid="sub-admin-table">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2">Order</th><th>When</th><th>Supplier → Customer</th><th>Missing</th><th>Instead</th><th>Price</th><th>Status</th></tr></thead>
              <tbody className="divide-y">
                {v.items.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2"><Link href={`/admin/orders/${r.orderId}#replacements`} className="font-mono text-xs text-primary hover:underline">{r.number}</Link></td>
                    <td className="text-xs text-muted-foreground">{date.format(new Date(r.createdAt))}</td>
                    <td>{r.supplier} → {r.buyer}</td>
                    <td>{r.shortQty} × {r.original}</td>
                    <td>{r.qty} × {r.substitute}</td>
                    <td className={`tabular-nums ${r.diffPct > 0 ? "delta-neg" : r.diffPct < 0 ? "delta-pos" : ""}`}>{pct(r.diffPct)}{r.priceMatch ? " · same price" : ""}</td>
                    <td><Badge variant={TONE[r.status]}>{LABEL[r.status]}{r.auto && r.status === "ACCEPTED" ? " · auto" : ""}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
