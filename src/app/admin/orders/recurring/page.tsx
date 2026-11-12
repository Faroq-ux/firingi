import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminRecurring } from "@/server/buying/recurring";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";
import { RECURRING_TONE } from "@/lib/buying";

export const metadata = { title: "Recurring orders" };
const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function AdminRecurring() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage"]);
  const rows = await adminRecurring(ctx);
  const date = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <>
      <PageHeader title="Recurring Orders" description="Standing orders customers and wholesalers set up. FIRINGI places them automatically (job: every 15 minutes) for the person who set them up, through the normal checkout; failures are shown here and the buyer is told." />
      <DataTable tableId="admin.recurring" testId="admin-recurring-table" empty="No recurring orders yet." exportName="recurring-orders"
        columns={[{ key: "name", label: "Name" }, { key: "buyer", label: "Buyer", filter: true }, { key: "when", label: "Schedule" }, { key: "next", label: "Next order", type: "date" }, { key: "items", label: "Products", type: "number" }, { key: "runs", label: "Runs", type: "number" }, { key: "last", label: "Last run" }, { key: "status", label: "Status", type: "badge", filter: true }]}
        rows={rows.map((r) => ({
          id: r.id,
          cells: {
            name: r.name, buyer: r.buyer, when: r.frequency === "MONTHLY" ? `Monthly, day ${r.dayOfMonth}` : `${r.frequency === "WEEKLY" ? "Weekly" : "Every 2 weeks"}, ${DAYS[r.weekday ?? 1]}`,
            next: r.status === "ACTIVE" ? { t: date.format(r.nextRunAt), v: r.nextRunAt.toISOString() } : null, items: r.items, runs: r.runs,
            last: r.lastResult ? { t: r.lastResult === "PLACED" ? "Placed" : r.lastResult === "SKIPPED" ? "Skipped" : "Failed", sub: r.lastError ?? undefined, tone: r.lastResult === "FAILED" ? "destructive" : r.lastResult === "PLACED" ? "success" : "outline" } : "—",
            status: { t: r.status === "PENDING_APPROVAL" ? "Waiting for buyer's approval" : r.status.charAt(0) + r.status.slice(1).toLowerCase(), tone: RECURRING_TONE[r.status] },
          },
        }))} />
    </>
  );
}
