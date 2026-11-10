import Link from "next/link";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { PlanPanel, RoutesList, routeLabels } from "@/components/routes/route-views";

export const metadata = { title: "Routes" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.orders.manage", "vendor.drivers.manage"]);
  const tab = (await searchParams).tab === "history" ? "history" : "open";
  const { l } = await routeLabels(false);
  const pill = (on: boolean) => `rounded-md border px-3 py-1 text-sm ${on ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`;
  return (
    <>
      <PageHeader title={l.title} description={l.intro} />
      <div className="space-y-4">
        {can(ctx, ["vendor.orders.manage", "vendor.drivers.manage"]) && <PlanPanel ctx={ctx} english={false} routeBase="/vendor/fleet/routes" />}
        <div className="flex flex-wrap gap-1">
          <Link href="?tab=open" className={pill(tab === "open")}>{l.open}</Link>
          <Link href="?tab=history" className={pill(tab === "history")}>{l.history}</Link>
        </div>
        <Card><CardContent className="pt-5"><RoutesList ctx={ctx} english={false} base="/vendor/fleet/routes" tab={tab} /></CardContent></Card>
      </div>
    </>
  );
}
