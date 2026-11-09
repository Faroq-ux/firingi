/** Delivery and return views shared by order pages, dispatch lists, the driver app and admin. */
import Link from "next/link";
import type { DeliveryStatus, ReturnStatus } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { deliveryForOrder, type DeliveryView } from "@/server/services/deliveries";
import { assignableFleet } from "@/server/services/fleet";
import { listReturns, RETURN_WINDOW_DAYS, returnableLines } from "@/server/services/returns";
import { pickLocalized } from "@/i18n/config";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { AssignForm, CarrierForm, ReturnActions, ReturnRequestForm, ReturnToSupplierButton } from "./delivery-forms";

const D_VARIANT: Record<DeliveryStatus, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  UNASSIGNED: "warning", ASSIGNED: "default", PICKED_UP: "default", OUT_FOR_DELIVERY: "default", DELIVERED: "success", FAILED: "destructive", RETURNED: "secondary", CANCELLED: "secondary",
};
const R_VARIANT: Record<ReturnStatus, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  REQUESTED: "warning", APPROVED: "default", REJECTED: "secondary", RECEIVED: "default", CREDITED: "success",
};

export async function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  const t = await getTranslations("delivery.statuses");
  return <Badge variant={D_VARIANT[status]}>{t(status)}</Badge>;
}

const file = (id: string, which: string) => `/api/deliveries/${id}/files/${which}`;
const mapLink = (lat: unknown, lng: unknown) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
type Addr = { label?: string; line1?: string; line2?: string; postalCode?: string; city?: string; phone?: string | null; contactName?: string | null; latitude?: string | null; longitude?: string | null };
export const addrLine = (a: Addr) => `${a.line1 ?? ""}${a.line2 ? `, ${a.line2}` : ""}, ${a.postalCode ?? ""} ${a.city ?? ""}`;
export const mapsHref = (a: Addr) =>
  a.latitude && a.longitude ? `https://www.google.com/maps/dir/?api=1&destination=${a.latitude},${a.longitude}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addrLine(a))}`;

/** Attempts and proof of delivery (photos are permission-checked by the file route). */
export async function DeliveryEvidence({ d }: { d: DeliveryView }) {
  const [t, tr, locale] = await Promise.all([getTranslations("delivery"), getTranslations("delivery.reasons"), getLocale()]);
  const failed = d.attempts.filter((a) => !a.succeeded);
  return (
    <>
      {failed.length > 0 && (
        <div className="space-y-2">
          <div className="text-muted-foreground">{t("attempts")}</div>
          {failed.map((a) => (
            <div key={a.id} className="rounded-md border border-destructive/30 p-2 text-xs">
              <div className="flex justify-between"><b>{t("failedAttempt")}</b><span>{formatDate(a.at, locale, true)}</span></div>
              <div>{a.reasonCode ? tr(a.reasonCode as never) : ""}{a.failureReason ? ` — ${a.failureReason}` : ""}</div>
              <div className="mt-1 flex gap-2">
                {a.photoKey && <a href={file(d.id, `attempt-${a.id}`)} target="_blank" className="text-primary hover:underline">{t("photo")}</a>}
                {a.latitude && <a href={mapLink(a.latitude, a.longitude)} target="_blank" className="text-primary hover:underline">{t("map")}</a>}
              </div>
            </div>
          ))}
        </div>
      )}
      {d.proof && (
        <div className="space-y-2" data-testid="pod">
          <div className="text-muted-foreground">{t("proof")}</div>
          <div className="font-medium">{t("receivedBy", { name: d.proof.recipientName })}</div>
          <div className="text-xs text-muted-foreground">{formatDate(d.proof.at, locale, true)}{d.proof.latitude && <> · <a href={mapLink(d.proof.latitude, d.proof.longitude)} target="_blank" className="text-primary hover:underline">{t("map")}</a></>}</div>
          <div className="flex flex-wrap gap-2">
            {d.proof.signatureKey && (
              // eslint-disable-next-line @next/next/no-img-element
              <a href={file(d.id, "signature")} target="_blank"><img src={file(d.id, "signature")} alt={t("signature")} className="h-16 rounded border bg-white" /></a>
            )}
            {d.proof.photoKeys.map((_, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <a key={i} href={file(d.id, `photo-${i}`)} target="_blank"><img src={file(d.id, `photo-${i}`)} alt={t("photos")} className="h-16 w-16 rounded border object-cover" /></a>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** Delivery card on the order page: status, driver, proof, and the dispatcher's controls. */
export async function DeliveryPanel({ ctx, orderId }: { ctx: Ctx; orderId: string }) {
  const view = await deliveryForOrder(ctx, orderId);
  if (!view) return null;
  const { delivery: d, role } = view;
  const [t, tm, locale] = await Promise.all([getTranslations("delivery"), getTranslations("orders.modes"), getLocale()]);
  const fleet = view.canAssign ? await assignableFleet(d.executingCompanyId) : null;
  return (
    <Card data-testid="delivery-panel">
      <CardHeader><CardTitle className="flex items-center justify-between gap-2">{t("title")} <DeliveryStatusBadge status={d.status} /></CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div><div className="text-muted-foreground">{t("executor")}</div><div>{d.executor.tradeName ?? d.executor.legalName} · {tm(d.mode)}</div></div>
        {d.mode === "CARRIER" ? (
          <div><div className="text-muted-foreground">{t("carrier")}</div><div>{d.carrierName ?? "—"}{d.trackingNumber ? ` · ${d.trackingNumber}` : ""}</div></div>
        ) : (
          <div><div className="text-muted-foreground">{t("driver")}</div>
            <div>{d.driver ? <>{d.driver.user.name}{role !== "VIEWER" && d.driver.user.phone ? ` · ${d.driver.user.phone}` : ""}</> : <span className="text-muted-foreground">{t("noDriver")}</span>}{d.vehicle ? ` · ${d.vehicle.plate}` : ""}</div>
          </div>
        )}
        {d.scheduledFor && <div><div className="text-muted-foreground">{t("scheduled")}</div><div>{formatDate(d.scheduledFor, locale)}</div></div>}
        {d.notes && role !== "VIEWER" && <div><div className="text-muted-foreground">{t("notes")}</div><div>{d.notes}</div></div>}
        <DeliveryEvidence d={d} />
        {view.canAssign && fleet && (
          <AssignForm
            deliveryId={d.id} driverId={d.driverId} vehicleId={d.vehicleId} retry={d.status === "FAILED"}
            scheduledFor={d.scheduledFor ? d.scheduledFor.toISOString().slice(0, 10) : null} notes={d.notes}
            drivers={fleet.drivers.map((x) => ({ id: x.id, name: x.user.name, availability: x.availability }))}
            vehicles={fleet.vehicles.map((v) => ({ id: v.id, label: `${v.plate}${v.isRefrigerated ? " ❄" : ""}` }))}
          />
        )}
        {fleet && !fleet.drivers.length && <p className="text-xs text-muted-foreground">{t("noDrivers")}</p>}
        {view.canSetCarrier && <CarrierForm deliveryId={d.id} carrierName={d.carrierName} trackingNumber={d.trackingNumber} />}
        {view.canReturnToSupplier && <ReturnToSupplierButton deliveryId={d.id} />}
        {role === "DRIVER" && <Link className="text-primary hover:underline" href={`/driver/deliveries/${d.id}`}>→ {t("title")}</Link>}
      </CardContent>
    </Card>
  );
}

/** Returns of one order: request form for the buyer, decisions for FIRINGI, receipt for the supplier. */
export async function OrderReturnsPanel({ ctx, orderId, role }: { ctx: Ctx; orderId: string; role: "BUYER" | "VENDOR" | "ADMIN" }) {
  const [t, ts, locale] = await Promise.all([getTranslations("delivery"), getTranslations("delivery.returnStatuses"), getLocale()]);
  const all = (await listReturns(ctx, role === "VENDOR" ? "VENDOR" : role)).filter((r) => r.orderId === orderId);
  const returnable = role === "BUYER" && can(ctx, "buyer.orders.place") ? await returnableLines(orderId) : null;
  const canAsk = returnable?.open && returnable.lines.some((l) => l.returnable > 0);
  if (!all.length && !canAsk) return null;
  const L = (v: unknown) => pickLocalized(v, locale);
  return (
    <Card data-testid="returns-panel">
      <CardHeader><CardTitle>{t("returns")}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {all.map((r) => (
          <div key={r.id} className="space-y-1 rounded-md border p-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><Badge variant={R_VARIANT[r.status]}>{ts(r.status)}</Badge><span className="text-xs text-muted-foreground">{formatDate(r.createdAt, locale, true)}</span></div>
            <ul className="text-xs">{r.lines.map((l) => <li key={l.id}>{l.qty} × {L(l.orderLine.productName)} · {L(l.orderLine.packagingName)}</li>)}</ul>
            <p className="text-xs">{r.reason}</p>
            {r.reviewNote && <p className="text-xs text-muted-foreground">{r.reviewNote}</p>}
            {r.photoKeys.length > 0 && <div className="flex gap-2">{r.photoKeys.map((_, i) => <a key={i} href={`/api/returns/${r.id}/photos/${i}`} target="_blank" className="text-xs text-primary hover:underline">{t("photo")} {i + 1}</a>)}</div>}
            <ReturnActions
              id={r.id}
              canReview={role === "ADMIN" && r.status === "REQUESTED" && can(ctx, "admin.orders.manage")}
              canReceive={r.status === "APPROVED" && ((role === "ADMIN" && can(ctx, "admin.orders.manage")) || (role === "VENDOR" && can(ctx, "vendor.orders.manage")))}
            />
          </div>
        ))}
        {canAsk && returnable && (
          <ReturnRequestForm
            orderId={orderId} days={RETURN_WINDOW_DAYS}
            lines={returnable.lines.filter((l) => l.returnable > 0).map((l) => ({ id: l.id, label: `${L(l.productName)} · ${L(l.packagingName)}`, returnable: l.returnable }))}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** Table of deliveries (dispatch boards and admin lists). */
export async function DeliveryTable({ rows, orderBase, showExecutor }: { rows: DeliveryView[]; orderBase: string; showExecutor?: boolean }) {
  const [t, tm, locale] = await Promise.all([getTranslations("delivery"), getTranslations("orders.modes"), getLocale()]);
  return (
    <Table>
      <THead><TR><TH>{t("order")}</TH><TH>{t("buyer")}</TH><TH>{t("address")}</TH>{showExecutor && <TH>{t("executor")}</TH>}<TH>{t("driver")}</TH><TH>{t("scheduled")}</TH><TH>{t("status")}</TH></TR></THead>
      <TBody>
        {rows.length === 0 && <EmptyRow colSpan={showExecutor ? 7 : 6}>{t("noDeliveries")}</EmptyRow>}
        {rows.map((d) => {
          const a = d.order.deliveryAddress as Addr;
          return (
            <TR key={d.id}>
              <TD><Link href={`${orderBase}/${d.order.id}`} className="font-mono text-primary hover:underline">{d.order.number}</Link></TD>
              <TD>{d.order.buyer.tradeName ?? d.order.buyer.legalName}</TD>
              <TD className="text-xs">{a.postalCode} {a.city}</TD>
              {showExecutor && <TD className="text-xs">{d.executor.tradeName ?? d.executor.legalName} · {tm(d.mode)}</TD>}
              <TD className="text-xs">{d.mode === "CARRIER" ? d.carrierName ?? "—" : d.driver?.user.name ?? "—"}{d.vehicle ? ` · ${d.vehicle.plate}` : ""}</TD>
              <TD className="text-xs">{d.scheduledFor ? formatDate(d.scheduledFor, locale) : "—"}</TD>
              <TD><DeliveryStatusBadge status={d.status} />{d.proof && <span className="ml-1 text-xs text-success">✓</span>}</TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

/** Returns list (buyer, vendor, FIRINGI). */
export async function ReturnsList({ ctx, as, orderBase, statuses }: { ctx: Ctx; as: "BUYER" | "VENDOR" | "ADMIN"; orderBase: string; statuses?: ReturnStatus[] }) {
  const [rows, t, ts, locale] = await Promise.all([listReturns(ctx, as, { statuses }), getTranslations("delivery"), getTranslations("delivery.returnStatuses"), getLocale()]);
  const L = (v: unknown) => pickLocalized(v, locale);
  return (
    <Table>
      <THead><TR><TH>{t("date")}</TH><TH>{t("order")}</TH><TH>{as === "BUYER" ? t("executor") : t("buyer")}</TH><TH>{t("products")}</TH><TH>{t("reason")}</TH><TH>{t("status")}</TH>{as !== "BUYER" && <TH />}</TR></THead>
      <TBody>
        {rows.length === 0 && <EmptyRow colSpan={7}>{t("noReturns")}</EmptyRow>}
        {rows.map((r) => (
          <TR key={r.id}>
            <TD className="text-xs">{formatDate(r.createdAt, locale)}</TD>
            <TD><Link href={`${orderBase}/${r.order.id}`} className="font-mono text-primary hover:underline">{r.order.number}</Link></TD>
            <TD className="text-xs">{as === "BUYER" ? r.order.seller.tradeName ?? r.order.seller.legalName : r.order.buyer.tradeName ?? r.order.buyer.legalName}</TD>
            <TD className="text-xs">{r.lines.map((l) => `${l.qty} × ${L(l.orderLine.productName)}`).join(", ")}</TD>
            <TD className="max-w-56 text-xs">{r.reason}{r.photoKeys.length ? ` · 📷 ${r.photoKeys.length}` : ""}</TD>
            <TD><Badge variant={R_VARIANT[r.status]}>{ts(r.status)}</Badge></TD>
            {as !== "BUYER" && (
              <TD>
                <ReturnActions
                  id={r.id}
                  canReview={as === "ADMIN" && r.status === "REQUESTED" && can(ctx, "admin.orders.manage")}
                  canReceive={r.status === "APPROVED" && (as === "ADMIN" ? can(ctx, "admin.orders.manage") : can(ctx, "vendor.orders.manage"))}
                />
              </TD>
            )}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
