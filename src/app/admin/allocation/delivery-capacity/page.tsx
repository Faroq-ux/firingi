import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { AllocationView } from "@/components/allocation/views";

export const metadata = { title: "Delivery Capacity" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, "admin.allocation.manage");
  return <AllocationView ctx={ctx} page="delivery-capacity" searchParams={await searchParams} />;
}
