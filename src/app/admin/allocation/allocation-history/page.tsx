import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { AllocationView } from "@/components/allocation/views";

export const metadata = { title: "Allocation History" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, "admin.allocation.manage");
  return <AllocationView ctx={ctx} page="allocation-history" searchParams={await searchParams} />;
}
