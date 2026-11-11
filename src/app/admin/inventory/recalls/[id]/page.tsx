import Link from "next/link";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { getRecall } from "@/server/warehouse/recalls";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { CloseRecall } from "@/components/warehouse/controls";
import { RecallView } from "@/components/warehouse/trace-view";
import { English, englishT } from "@/components/warehouse/english";

export const metadata = { title: "Recall" };

export default async function AdminRecall({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.inventory.view", "admin.inventory.manage", "admin.recalls.manage"]);
  const t = englishT;
  const r = await getRecall(ctx, (await params).id, "en");
  return (
    <English>
      <PageHeader title={`Recall ${r.number}`} description={`${r.supplier} · ${r.product} · lot ${r.lotCode ?? "—"}`}
        actions={<Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/admin/inventory/trace?offer=${r.offerId}&lot=${encodeURIComponent(r.lotCode ?? "")}`}>Trace</Link>} />
      <RecallView r={r} t={t as never} locale="en" />
      {r.status === "OPEN" && can(ctx, "admin.recalls.manage") && <div className="mt-6"><CloseRecall id={r.id} /></div>}
    </English>
  );
}
