import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { AllocationView } from "@/components/allocation/views";

export const metadata = { title: "Distributor vs Wholesaler" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, "admin.allocation.manage");
  return <AllocationView ctx={ctx} page="distributor-vs-wholesaler" searchParams={await searchParams} />;
}
