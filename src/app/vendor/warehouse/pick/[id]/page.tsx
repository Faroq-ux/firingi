import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { featureOn } from "@/server/warehouse/features";
import { FeatureOff } from "@/components/warehouse/feature-off";
import { getPickList } from "@/server/warehouse/picking";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CancelPickList, PackOrder, PickRunner } from "@/components/warehouse/controls";
import { OrderWeightsCard } from "@/components/catchweight/views";

export const metadata = { title: "Pick list" };

export default async function PickListPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.warehouse.pick", "vendor.inventory.manage", "vendor.inventory.view"]);
  const [t, locale] = await Promise.all([getTranslations("warehouse"), getLocale()]);
  if (!(await featureOn(ctx, "PICK_PACK"))) return <FeatureOff title={t("pickTitle")} />;
  const pl = await getPickList(ctx, (await params).id, locale);
  const canPick = can(ctx, ["vendor.warehouse.pick", "vendor.inventory.manage"]);
  const open = pl.status === "OPEN" || pl.status === "PICKED";
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  return (
    <>
      <PageHeader title={`${t("pickList")} ${pl.number}`} description={`${pl.warehouse} · ${t(`pl.${pl.status}`)}`}
        actions={canPick && open && !pl.orders.some((o) => o.packedAt) ? <CancelPickList id={pl.id} /> : undefined} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader><CardTitle>{t("pick")}</CardTitle></CardHeader>
          <CardContent>
            {canPick && (pl.status === "OPEN" || pl.status === "PICKED")
              ? <PickRunner open lines={pl.lines.map((l) => ({ ...l, expiresOn: day(l.expiresOn) }))} />
              : (
                <ol className="divide-y rounded-xl border text-sm" data-testid="pick-lines">
                  {pl.lines.map((l) => (
                    <li key={l.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="w-16 shrink-0 font-mono text-xs font-semibold">{l.bin ?? "—"}</span>
                      <span className="min-w-0 flex-1 truncate">{l.product} <span className="text-muted-foreground">· {l.lotCode ?? "—"} · {l.orderNumber}</span></span>
                      <span className="tabular-nums">{l.pickedQty}/{l.qty}</span>
                      {l.shortReason === "RECALLED" ? <Badge variant="destructive">{t("recalledPutAside")}</Badge> : l.shortReason ? <Badge variant="outline" title={l.shortReason}>{t("shortBadge")}</Badge> : null}
                    </li>
                  ))}
                </ol>
              )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("pack")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {pl.orders.map((o) => (
              <div key={o.id} className="rounded-xl border p-3" data-testid={`pack-order-${o.number}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/vendor/orders/${o.id}`} className="font-mono font-semibold hover:underline">{o.number}</Link>
                  <span className="text-xs text-muted-foreground">{o.status === "CANCELLED" ? t("orderCancelled") : o.done ? t("pickedN", { count: o.units }) : t("stillPicking")}</span>
                </div>
                <p className="text-sm">{o.buyer}</p>
                <p className="mb-2 text-xs text-muted-foreground">{[o.address?.line1, [o.address?.postalCode, o.address?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</p>
                {o.short > 0 && <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">{t("shortOnOrder", { count: o.short })}</p>}
                {o.status !== "CANCELLED" && <PackOrder pickListId={pl.id} orderId={o.id} number={o.number} canPack={canPick && o.canPack} packed={!!o.packedAt} boxes={o.boxes} />}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      {/* Phase 41: products sold by weight on this pick list — scale labels scanned above count the piece and record its weight */}
      {canPick && open && pl.orders.filter((o) => o.status !== "CANCELLED").map((o) => <OrderWeightsCard key={o.id} ctx={ctx} orderId={o.id} as="SUPPLIER" pickSource />)}
    </>
  );
}
