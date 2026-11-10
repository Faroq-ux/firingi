import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { ScorecardsView } from "@/components/profit/scorecards-view";

export const metadata = { title: "Distributor Performance" };

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve"]);
  return <ScorecardsView ctx={ctx} type="DISTRIBUTOR" title="Distributor Performance" sp={await searchParams} />;
}
