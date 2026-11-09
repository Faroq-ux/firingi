/** Driver app: big, touch-friendly cards. */
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { listDeliveries, type DeliveryView } from "@/server/services/deliveries";
import { driverActions } from "@/server/delivery/state";
import { pickLocalized } from "@/i18n/config";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { addrLine, DeliveryStatusBadge, mapsHref } from "./delivery-views";
import { DriverStepButton } from "./delivery-forms";

type Addr = Parameters<typeof addrLine>[0];

export async function DriverDeliveryCard({ d, withActions }: { d: DeliveryView; withActions?: boolean }) {
  const [t, locale] = await Promise.all([getTranslations("delivery"), getLocale()]);
  const a = d.order.deliveryAddress as Addr;
  const actions = withActions ? driverActions(d.status, d.order.status) : [];
  const items = d.order.lines.reduce((n, l) => n + (l.qtyConfirmed ?? l.qtyOrdered), 0);
  return (
    <Card data-testid="driver-delivery">
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <Link href={`/driver/deliveries/${d.id}`} className="font-mono text-base font-semibold text-primary hover:underline">{d.order.number}</Link>
            <div className="text-sm font-medium">{d.order.buyer.tradeName ?? d.order.buyer.legalName}</div>
          </div>
          <DeliveryStatusBadge status={d.status} />
        </div>
        <div className="text-sm">
          <div className="text-muted-foreground">{t("deliverTo")}</div>
          <div>{addrLine(a)}</div>
          <div className="mt-1 flex gap-3 text-sm">
            <a className="text-primary hover:underline" href={mapsHref(a)} target="_blank">{t("navigate")}</a>
            {a.phone && <a className="text-primary hover:underline" href={`tel:${a.phone}`}>{t("call")}</a>}
          </div>
        </div>
        {d.order.sourceAddress && (
          <div className="text-sm"><div className="text-muted-foreground">{t("pickupAt")}</div><div>{d.order.seller.tradeName ?? d.order.seller.legalName} — {d.order.sourceAddress.line1}, {d.order.sourceAddress.cityName}</div></div>
        )}
        <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
          <span>{t("products")}: {items}</span>
          {d.scheduledFor && <span>{t("scheduled")}: {formatDate(d.scheduledFor, locale)}</span>}
          {d.vehicle && <span>{t("vehicle")}: {d.vehicle.plate}</span>}
        </div>
        {d.notes && <p className="rounded bg-muted p-2 text-xs">{d.notes}</p>}
        {withActions && d.status === "ASSIGNED" && !actions.length && <p className="text-xs text-muted-foreground">{t("waitingReady")}</p>}
        {actions.includes("PICK_UP") && <DriverStepButton deliveryId={d.id} step="PICK_UP" />}
        {actions.includes("START") && <DriverStepButton deliveryId={d.id} step="START" />}
        {(actions.includes("DELIVER") || actions.includes("FAIL")) && (
          <Link href={`/driver/deliveries/${d.id}`} className="flex h-12 w-full items-center justify-center rounded-md bg-primary text-base font-medium text-primary-foreground">{t("deliver")}</Link>
        )}
      </CardContent>
    </Card>
  );
}

export async function DriverList({ ctx, period }: { ctx: Ctx; period: "TODAY" | "HISTORY" }) {
  const [rows, t] = await Promise.all([listDeliveries(ctx, { as: "DRIVER", period, take: period === "HISTORY" ? 50 : 100 }), getTranslations("delivery")]);
  if (!rows.length) return <p className="py-10 text-center text-sm text-muted-foreground">{period === "TODAY" ? t("nothingToday") : t("noDeliveries")}</p>;
  return <div className="grid gap-3 md:grid-cols-2">{rows.map((d) => <DriverDeliveryCard key={d.id} d={d} withActions={period === "TODAY"} />)}</div>;
}

export async function DriverItems({ d }: { d: DeliveryView }) {
  const locale = await getLocale();
  return (
    <ul className="divide-y text-sm">
      {d.order.lines.map((l) => (
        <li key={l.id} className="flex justify-between py-1.5"><span>{pickLocalized(l.productName, locale)} <span className="text-xs text-muted-foreground">· {pickLocalized(l.packagingName, locale)}</span></span><b className="tabular-nums">{l.qtyConfirmed ?? l.qtyOrdered}</b></li>
      ))}
    </ul>
  );
}
