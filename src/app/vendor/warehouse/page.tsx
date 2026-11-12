import { redirect } from "next/navigation";
import { pagePortal } from "@/server/rbac/guard";
import { warehouseFeatures } from "@/server/warehouse/features";

/** First warehouse page that is switched on for the supplier. */
export default async function WarehouseIndex() {
  const ctx = await pagePortal("vendor");
  const f = await warehouseFeatures(ctx.company.id);
  redirect(f.pickPack ? "/vendor/warehouse/pick" : f.bins ? "/vendor/warehouse/shelves" : f.traceability ? "/vendor/warehouse/trace" : "/vendor/warehouse/recalls");
}
