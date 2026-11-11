import Link from "next/link";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listRecalls } from "@/server/warehouse/recalls";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable, type Tone } from "@/components/ui/data-table";
import { buttonVariants } from "@/components/ui/button";
import { Tile } from "@/components/motion/dashboard-kit";
import { BellRing, PackageX, Siren, TriangleAlert } from "lucide-react";

export const metadata = { title: "Recalls" };
const CLS: Record<string, Tone> = { CLASS_I: "destructive", CLASS_II: "warning", CLASS_III: "secondary" };
const CLASS_LABEL: Record<string, string> = { CLASS_I: "Class I — health risk", CLASS_II: "Class II — temporary risk", CLASS_III: "Class III — quality" };

export default async function AdminRecalls() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.inventory.view", "admin.inventory.manage", "admin.recalls.manage"]);
  const rows = await listRecalls(ctx);
  const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const open = rows.filter((r) => r.status === "OPEN");
  return (
    <>
      <PageHeader title="Recalls" description="Every product recall on FIRINGI — started by a supplier for its own lot, or by FIRINGI. Follow who has been told, who acknowledged and what was returned or destroyed."
        actions={<Link href="/admin/inventory/trace" className={buttonVariants({ variant: "outline" })}>Trace a lot</Link>} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="recall-kpis">
        <Tile icon={Siren} label="Open recalls" value={open.length} locale="en" tone="tone-pink" i={0} />
        <Tile icon={BellRing} label="Buyers still to act" value={open.reduce((a, r) => a + r.recipients - r.done, 0)} locale="en" tone="tone-orange" i={1} />
        <Tile icon={PackageX} label="Units blocked" value={rows.reduce((a, r) => a + r.blockedUnits, 0)} locale="en" tone="tone-violet" i={2} />
        <Tile icon={TriangleAlert} label="Order units not covered" value={rows.reduce((a, r) => a + r.notReReserved, 0)} locale="en" tone="tone-blue" i={3} />
      </div>
      <DataTable tableId="admin.recalls" testId="recalls-table" empty="No recalls yet." exportName="recalls"
        columns={[{ key: "number", label: "Recall" }, { key: "date", label: "Started", type: "date" }, { key: "supplier", label: "Supplier", filter: true }, { key: "product", label: "Product" }, { key: "lot", label: "Lot" }, { key: "cls", label: "Class", type: "badge", filter: true }, { key: "by", label: "Started by", filter: true }, { key: "blocked", label: "Units blocked", type: "number" }, { key: "ack", label: "Acknowledged", type: "number" }, { key: "done", label: "Done", type: "number" }, { key: "status", label: "Status", type: "badge", filter: true }]}
        rows={rows.map((r) => ({
          id: r.id, href: `/admin/inventory/recalls/${r.id}`,
          cells: {
            number: { t: r.number, mono: true, href: `/admin/inventory/recalls/${r.id}` }, date: { t: date.format(r.createdAt), v: r.createdAt.toISOString() }, supplier: r.supplier,
            product: { t: `${pickLocalized(r.product, "en")} · ${pickLocalized(r.packaging, "en")}`, sub: r.sku ?? undefined }, lot: { t: r.lotCode ?? "—", mono: true },
            cls: { t: CLASS_LABEL[r.recallClass], tone: CLS[r.recallClass] }, by: r.startedByFiringi ? "FIRINGI" : "Supplier", blocked: r.blockedUnits,
            ack: { t: `${r.acknowledged} / ${r.recipients}`, v: r.acknowledged }, done: { t: `${r.done} / ${r.recipients}`, v: r.done },
            status: { t: r.status === "OPEN" ? "Open" : "Closed", tone: r.status === "OPEN" ? "destructive" : "outline" },
          },
        }))} />
    </>
  );
}
