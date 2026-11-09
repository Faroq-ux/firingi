import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { AdminAnalyticsView } from "@/components/analytics/admin-views";

export const metadata = { title: "Product Analytics" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, "admin.analytics.view");
  return <AdminAnalyticsView ctx={ctx} kind="products" searchParams={await searchParams} />;
}
