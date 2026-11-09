import Link from "next/link";
import type { DeliveryStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { deliveryCounts, listDeliveries } from "@/server/services/deliveries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DeliveryTable } from "@/components/delivery/delivery-views";

export const metadata = { title: "Deliveries" };
const OPEN: DeliveryStatus[] = ["UNASSIGNED", "ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "FAILED"];
const TABS: (DeliveryStatus | "OPEN" | "ALL")[] = ["OPEN", "UNASSIGNED", "ASSIGNED", "OUT_FOR_DELIVERY", "FAILED", "DELIVERED", "ALL"];

export default async function Page({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.orders.view", "vendor.fleet.view"]);
  const s = ((await searchParams).s ?? "OPEN") as (typeof TABS)[number];
  const statuses = s === "OPEN" ? OPEN : s === "ALL" ? undefined : [s as DeliveryStatus];
  const [rows, counts, t, ts] = await Promise.all([listDeliveries(ctx, { as: "DISPATCH", statuses }), deliveryCounts(ctx, "DISPATCH"), getTranslations("delivery"), getTranslations("delivery.statuses")]);
  return (
    <>
      <PageHeader title={t("deliveries")} description={t("deliveriesIntro")} />
      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((x) => (
          <Link key={x} href={`?s=${x}`} className={`rounded-md border px-3 py-1 text-sm ${x === s ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
            {x === "OPEN" ? `${t("openDeliveries")} (${OPEN.reduce((a, k) => a + (counts[k] ?? 0), 0)})` : x === "ALL" ? t("all") : `${ts(x)} (${counts[x] ?? 0})`}
          </Link>
        ))}
      </div>
      <Card><CardContent className="pt-5"><DeliveryTable rows={rows} orderBase="/vendor/orders" /></CardContent></Card>
    </>
  );
}
