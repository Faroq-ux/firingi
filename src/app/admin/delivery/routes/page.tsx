import Link from "next/link";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { RoutesList } from "@/components/routes/route-views";

export const metadata = { title: "Routes" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; all?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.delivery.view", "admin.delivery.manage"]);
  const sp = await searchParams;
  const tab = sp.tab === "history" ? "history" : "open";
  const all = sp.all === "1";
  const q = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ tab, all: all ? "1" : undefined, ...o }).filter(([, v]) => v) as [string, string][]).toString();
  const pill = (on: boolean) => `rounded-md border px-3 py-1 ${on ? "bg-primary text-primary-foreground" : ""}`;
  return (
    <>
      <PageHeader title="Routes" description="Multi-stop runs: one driver, one day, pickups at the suppliers then the customers in the shortest order."
        actions={<Link href="/admin/delivery/multi-stop" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">Plan routes</Link>} />
      <div className="mb-3 flex flex-wrap gap-1 text-sm">
        <Link href={q({ tab: "open" })} className={pill(tab === "open")}>Open</Link>
        <Link href={q({ tab: "history" })} className={pill(tab === "history")}>History</Link>
        <span className="mx-2" />
        <Link href={q({ all: undefined })} className={pill(!all)}>FIRINGI fleet</Link>
        <Link href={q({ all: "1" })} className={pill(all)}>All fleets</Link>
      </div>
      <Card><CardContent className="pt-5"><RoutesList ctx={ctx} english base="/admin/delivery/routes" tab={tab} all={all} /></CardContent></Card>
    </>
  );
}
