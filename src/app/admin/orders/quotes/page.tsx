import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminQuotes } from "@/server/buying/quotes";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";
import { Tile } from "@/components/motion/dashboard-kit";
import { FileQuestion, Handshake, Percent, Timer } from "lucide-react";
import { QUOTE_TONE } from "@/lib/buying";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Quotes" };
const LABEL: Record<string, string> = { REQUESTED: "Waiting for supplier", QUOTED: "Quoted", ACCEPTED: "Accepted", DECLINED: "Declined by supplier", REJECTED: "Rejected by buyer", EXPIRED: "Expired", CANCELLED: "Withdrawn" };

export default async function AdminQuotes() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage"]);
  const rows = await adminQuotes(ctx);
  const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const answered = rows.filter((r) => r.status !== "REQUESTED" && r.status !== "CANCELLED");
  const accepted = rows.filter((r) => r.status === "ACCEPTED");
  return (
    <>
      <PageHeader title="Quotes" description="Every quote request between buyers and suppliers. Buyers never see FIRINGI's commission; suppliers see what they receive after it. Accepted quotes become normal orders at the quoted prices." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="admin-quote-kpis">
        <Tile icon={Timer} label="Waiting for suppliers" value={rows.filter((r) => r.status === "REQUESTED").length} locale="en" tone="tone-orange" i={0} />
        <Tile icon={FileQuestion} label="Answered" value={answered.length} locale="en" tone="tone-blue" i={1} />
        <Tile icon={Handshake} label="Won (accepted)" value={accepted.length} locale="en" tone="tone-teal" i={2} />
        <Tile icon={Percent} label="Commission on accepted" value={accepted.reduce((a, r) => a + Number(r.commission ?? 0), 0)} fmt="money" locale="en" tone="tone-violet" i={3} />
      </div>
      <DataTable tableId="admin.quotes" testId="admin-quotes-table" empty="No quote requests yet." exportName="quotes"
        columns={[{ key: "number", label: "Quote" }, { key: "date", label: "Asked", type: "date" }, { key: "buyer", label: "Buyer", filter: true }, { key: "supplier", label: "Supplier", filter: true }, { key: "list", label: "At list price", type: "money" }, { key: "total", label: "Quoted", type: "money" }, { key: "disc", label: "Discount %", type: "number" }, { key: "comm", label: "FIRINGI commission", type: "money" }, { key: "status", label: "Status", type: "badge", filter: true }]}
        rows={rows.map((q) => ({
          id: q.id, href: q.orderId ? `/admin/orders/${q.orderId}` : undefined,
          cells: {
            number: { t: q.number, mono: true }, date: { t: date.format(q.createdAt), v: q.createdAt.toISOString() }, buyer: q.buyer, supplier: q.supplier,
            list: { t: formatMoney(q.listTotal, "en"), v: Number(q.listTotal) }, total: q.total ? { t: formatMoney(q.total, "en"), v: Number(q.total) } : null,
            disc: q.discountPct ? Number(q.discountPct) : null, comm: q.commission ? { t: formatMoney(q.commission, "en"), v: Number(q.commission) } : null, status: { t: LABEL[q.status], tone: QUOTE_TONE[q.status] },
          },
        }))} />
    </>
  );
}
