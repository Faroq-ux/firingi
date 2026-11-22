import Link from "next/link";
import { Store } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminStorefronts } from "@/server/storefront/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminStoreActions, AdminStorefrontSettings } from "@/components/storefront/client";

export const metadata = { title: "Storefronts" };
export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = { DRAFT: "Not published", PENDING: "Waiting for approval", PUBLISHED: "Published", SUSPENDED: "Suspended" };
const TONE: Record<string, "success" | "warning" | "secondary" | "destructive"> = { DRAFT: "secondary", PENDING: "warning", PUBLISHED: "success", SUSPENDED: "destructive" };

export default async function AdminStorefrontsPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve", "admin.settings.manage"]);
  const v = await adminStorefronts(ctx);
  const count = (s: string) => v.items.filter((x) => x.status === s).length;
  const sum = (k: "views30" | "signups30" | "customers") => v.items.reduce((a, x) => a + x[k], 0);
  const tiles = [
    { label: "Published", value: String(count("PUBLISHED")) },
    { label: "Waiting for approval", value: String(count("PENDING")) },
    { label: "Visits (30 days)", value: String(sum("views30")) },
    { label: "Registrations (30 days)", value: String(sum("signups30")) },
    { label: "Businesses from storefronts", value: String(sum("customers")) },
  ];
  const canAct = ctx.permissions.has("admin.vendors.approve") || ctx.permissions.has("admin.settings.manage");
  return (
    <>
      <PageHeader title="Storefronts" icon={Store} description="Wholesalers' and distributors' own pages on FIRINGI (/s/<name>): branding, delivery terms, current offers and products — never prices. Businesses registering from a store's link are linked to it. FIRINGI still invoices every order." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="sf-admin-tiles">
        {tiles.map((x) => <Card key={x.label}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{x.label}</p><p className="text-xl font-semibold tabular-nums">{x.value}</p></CardContent></Card>)}
      </div>
      <Card className="mb-6">
        <CardHeader><CardTitle>Settings</CardTitle><CardDescription>Every switch applies to all stores; a single store can be suspended below.</CardDescription></CardHeader>
        <CardContent>{ctx.permissions.has("admin.settings.manage") ? <AdminStorefrontSettings s={v.settings} /> : <p className="text-sm text-muted-foreground">View only.</p>}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Stores</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {!v.items.length ? <p className="py-4 text-center text-sm text-muted-foreground">No storefronts yet.</p> : (
            <table className="w-full min-w-[820px] text-sm" data-testid="sf-admin-table">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2">Store</th><th>Link</th><th>Status</th><th>Visits / sign-ups (30 d)</th><th>Businesses</th><th /></tr></thead>
              <tbody className="divide-y">
                {v.items.map((x) => (
                  <tr key={x.companyId} data-status={x.status}>
                    <td className="py-2"><span className="font-medium">{x.name}</span> <span className="text-xs text-muted-foreground">· {x.type === "DISTRIBUTOR" ? "Distributor" : "Wholesaler"} · {x.country}</span>{x.tagline && <p className="text-xs text-muted-foreground">{x.tagline}</p>}{x.reviewNote && <p className="text-xs">Note: {x.reviewNote}</p>}</td>
                    <td><Link href={`/s/${x.slug}`} target="_blank" className="font-mono text-xs text-primary hover:underline">/s/{x.slug}</Link></td>
                    <td><Badge variant={TONE[x.status]}>{LABEL[x.status]}</Badge></td>
                    <td className="tabular-nums">{x.views30} / {x.signups30}</td>
                    <td className="tabular-nums">{x.customers}</td>
                    <td>{canAct && <AdminStoreActions companyId={x.companyId} status={x.status} />}</td>
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
