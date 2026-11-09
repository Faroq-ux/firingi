import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { AllocationView } from "@/components/allocation/views";

export const metadata = { title: "Distance Rules" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, "admin.allocation.manage");
  return <AllocationView ctx={ctx} page="distance-rules" searchParams={await searchParams} />;
}
