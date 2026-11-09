import Link from "next/link";
import type { DeliveryStatus } from "@prisma/client";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { deliveryCounts, listDeliveries } from "@/server/services/deliveries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DeliveryTable } from "@/components/delivery/delivery-views";

export const metadata = { title: "Delivery Control Tower" };
const OPEN: DeliveryStatus[] = ["UNASSIGNED", "ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "FAILED"];
const TILES: { s: DeliveryStatus; label: string; tone: string }[] = [
  { s: "UNASSIGNED", label: "Not assigned", tone: "text-warning" }, { s: "ASSIGNED", label: "Assigned", tone: "" }, { s: "PICKED_UP", label: "Picked up", tone: "" },
  { s: "OUT_FOR_DELIVERY", label: "Out for delivery", tone: "text-primary" }, { s: "FAILED", label: "Failed", tone: "text-destructive" }, { s: "DELIVERED", label: "Delivered", tone: "text-success" },
];

export default async function Page({ searchParams }: { searchParams: Promise<{ s?: string; x?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.delivery.view", "admin.delivery.manage"]);
  const sp = await searchParams;
  const s = sp.s as DeliveryStatus | undefined;
  const x = sp.x === "FIRINGI" || sp.x === "VENDORS" ? sp.x : undefined;
  const [counts, rows] = await Promise.all([deliveryCounts(ctx, "ADMIN"), listDeliveries(ctx, { as: "ADMIN", statuses: s ? [s] : OPEN, executor: x })]);
  const q = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ s, x, ...o }).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Delivery Control Tower" description="Every delivery on the platform: FIRINGI fleet, vendor fleets and carriers." />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {TILES.map((t) => (
          <Link key={t.s} href={q({ s: t.s })} className={`rounded-lg border bg-card p-3 transition hover:shadow-sm ${s === t.s ? "ring-2 ring-primary" : ""}`}>
            <div className="text-xs text-muted-foreground">{t.label}</div><div className={`text-2xl font-semibold tabular-nums ${t.tone}`}>{counts[t.s] ?? 0}</div>
          </Link>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-1 text-sm">
        <Link href={q({ s: undefined })} className={`rounded-md border px-3 py-1 ${!s ? "bg-primary text-primary-foreground" : ""}`}>All open</Link>
        {(["", "FIRINGI", "VENDORS"] as const).map((e) => (
          <Link key={e || "all"} href={q({ x: e || undefined })} className={`rounded-md border px-3 py-1 ${(x ?? "") === e ? "bg-primary text-primary-foreground" : ""}`}>{e === "" ? "All fleets" : e === "FIRINGI" ? "FIRINGI fleet" : "Vendor fleets"}</Link>
        ))}
      </div>
      <Card><CardContent className="pt-5"><DeliveryTable rows={rows} orderBase="/admin/orders" showExecutor /></CardContent></Card>
    </>
  );
}
