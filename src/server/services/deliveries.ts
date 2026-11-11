/**
 * Deliveries — dispatching, the driver's steps, proof of delivery, failed deliveries.
 *
 * Who does what:
 *   • dispatcher = the company executing the delivery: the vendor (vendor.orders.manage) for
 *     free vendor deliveries and carrier shipments, FIRINGI (admin.delivery.manage) for
 *     FIRINGI-fleet deliveries. FIRINGI admins with admin.delivery.manage can step in anywhere.
 *   • driver = the assigned, approved driver (driver.deliveries.update / driver.pod.capture).
 *   • buyer / seller / FIRINGI can follow the delivery and see the proof.
 * Every step moves the order through orders.applyOrderTransition (stock, invoice, history).
 */
import type { DeliveryStatus, OrderStatus, Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { canMoveDelivery, driverActions, FAILURE_REASONS, orderStatusFor, type FailureReason } from "@/server/delivery/state";
import { nextStatuses } from "@/server/orders/state";
import { applyOrderTransition, ensureDelivery, notifyOrderChange } from "./orders";
import { storeUpload } from "./storage";
import { writeAudit } from "./audit";
import { assertDriverCapacity } from "./delivery-settings";
import { notify } from "@/server/notify/dispatch";
import { detachFromRoute, onDeliveryStep } from "./routes";

const isAdmin = (ctx: Ctx) => ctx.company.type === "ADMIN";

type DeliveryRole = "DISPATCHER" | "DRIVER" | "VIEWER";

const deliveryInclude = {
  order: {
    select: {
      id: true, number: true, status: true, deliveryAddress: true, grandTotal: true, buyerNotes: true, requestedDeliveryDate: true,
      buyerCompanyId: true, sellerCompanyId: true, placedAt: true,
      buyer: { select: { id: true, legalName: true, tradeName: true, phone: true } },
      seller: { select: { id: true, legalName: true, tradeName: true } },
      sourceAddress: { select: { label: true, line1: true, postalCode: true, cityName: true, phone: true } },
      lines: { select: { id: true, sku: true, productName: true, packagingName: true, qtyOrdered: true, qtyConfirmed: true, qtyDelivered: true } },
    },
  },
  executor: { select: { id: true, legalName: true, tradeName: true, type: true } },
  driver: { select: { id: true, user: { select: { name: true, phone: true } } } },
  vehicle: { select: { id: true, plate: true, type: true } },
  attempts: { orderBy: { at: "asc" } },
  proof: true,
} satisfies Prisma.DeliveryInclude;
export type DeliveryView = Prisma.DeliveryGetPayload<{ include: typeof deliveryInclude }>;

/** Create deliveries for confirmed orders that predate Phase 6 (idempotent, cheap when none). */
async function backfill() {
  const missing = await prisma.order.findMany({
    where: { delivery: null, deliveryMode: { not: null }, status: { in: ["SUPPLIER_PROCESSING", "READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "EXCEPTION"] } },
    select: { id: true, status: true }, take: 200,
  });
  for (const o of missing)
    await prisma.$transaction(async (tx) => {
      const id = await ensureDelivery(tx, o.id);
      const st: DeliveryStatus | null = o.status === "DISPATCHED" ? "PICKED_UP" : o.status === "OUT_FOR_DELIVERY" ? "OUT_FOR_DELIVERY" : null;
      if (st) await tx.delivery.update({ where: { id }, data: { status: st, pickedUpAt: new Date() } });
    });
}

function canDispatch(ctx: Ctx, d: { executingCompanyId: string }) {
  if (isAdmin(ctx)) return can(ctx, "admin.delivery.manage");
  return d.executingCompanyId === ctx.company.id && can(ctx, "vendor.orders.manage");
}

function roleOf(ctx: Ctx, d: { executingCompanyId: string; driverId: string | null; order: { buyerCompanyId: string; sellerCompanyId: string } }): DeliveryRole | null {
  if (canDispatch(ctx, d)) return "DISPATCHER";
  if (ctx.driver && d.driverId === ctx.driver.id && can(ctx, "driver.deliveries.view")) return "DRIVER";
  if (isAdmin(ctx) && can(ctx, ["admin.delivery.view", "admin.orders.view", "admin.orders.manage"])) return "VIEWER";
  if (d.order.buyerCompanyId === ctx.company.id && can(ctx, "buyer.orders.view")) return "VIEWER";
  if ((d.order.sellerCompanyId === ctx.company.id || d.executingCompanyId === ctx.company.id) && can(ctx, ["vendor.orders.view", "vendor.fleet.view"])) return "VIEWER";
  return null;
}

async function load(ctx: Ctx, id: string) {
  const d = await prisma.delivery.findUnique({ where: { id }, include: deliveryInclude });
  if (!d) throw new NotFoundError("Delivery");
  const role = roleOf(ctx, d);
  if (!role) throw new NotFoundError("Delivery");
  return { d, role };
}

// ── reading ─────────────────────────────────────────────────────────────────

export type DeliveryFilter = {
  as: "DISPATCH" | "ADMIN" | "DRIVER";
  statuses?: DeliveryStatus[];
  executor?: "FIRINGI" | "VENDORS";
  period?: "TODAY" | "HISTORY";
  withProof?: boolean;
  take?: number;
};

export async function listDeliveries(ctx: Ctx, f: DeliveryFilter) {
  const where: Prisma.DeliveryWhereInput = {};
  if (f.as === "DISPATCH") {
    if (isAdmin(ctx) ? !can(ctx, ["admin.delivery.view", "admin.delivery.manage"]) : !can(ctx, ["vendor.orders.view", "vendor.orders.manage", "vendor.fleet.view"])) throw new ForbiddenError();
    await backfill();
    where.executingCompanyId = ctx.company.id;
  } else if (f.as === "ADMIN") {
    if (!isAdmin(ctx) || !can(ctx, ["admin.delivery.view", "admin.delivery.manage"])) throw new ForbiddenError();
    await backfill();
    if (f.executor === "FIRINGI") where.executor = { type: "ADMIN" };
    if (f.executor === "VENDORS") where.executor = { type: { not: "ADMIN" } };
  } else {
    if (!ctx.driver || !can(ctx, "driver.deliveries.view")) throw new ForbiddenError();
    where.driverId = ctx.driver.id;
    if (f.period === "TODAY") where.status = { in: ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"] };
    if (f.period === "HISTORY") where.status = { in: ["DELIVERED", "FAILED", "RETURNED"] };
  }
  if (f.statuses?.length) where.status = { in: f.statuses };
  if (f.withProof) where.proof = { isNot: null };
  return prisma.delivery.findMany({
    where, include: deliveryInclude, take: f.take ?? 200,
    orderBy: f.period === "HISTORY" || f.withProof ? [{ completedAt: "desc" }, { updatedAt: "desc" }] : [{ scheduledFor: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });
}

/** Counts per status for the control tower. */
export async function deliveryCounts(ctx: Ctx, as: "ADMIN" | "DISPATCH") {
  if (as === "ADMIN" ? !isAdmin(ctx) || !can(ctx, ["admin.delivery.view", "admin.delivery.manage"]) : !can(ctx, ["vendor.orders.view", "vendor.fleet.view"])) throw new ForbiddenError();
  await backfill();
  const rows = await prisma.delivery.groupBy({ by: ["status"], where: as === "DISPATCH" ? { executingCompanyId: ctx.company.id } : {}, _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<Record<DeliveryStatus, number>>;
}

export async function deliveryForViewer(ctx: Ctx, id: string) {
  const { d, role } = await load(ctx, id);
  return {
    delivery: d, role,
    driverActions: role === "DRIVER" ? driverActions(d.status, d.order.status) : [],
    canAssign: role === "DISPATCHER" && d.mode !== "CARRIER" && ["UNASSIGNED", "ASSIGNED", "PICKED_UP", "FAILED"].includes(d.status),
    canSetCarrier: role === "DISPATCHER" && d.mode === "CARRIER" && !["DELIVERED", "RETURNED", "CANCELLED"].includes(d.status),
    canReturnToSupplier: role === "DISPATCHER" && d.status === "FAILED",
  };
}

/** The delivery of an order, if the viewer may see it (order pages). */
export async function deliveryForOrder(ctx: Ctx, orderId: string) {
  const d = await prisma.delivery.findUnique({ where: { orderId }, select: { id: true } });
  if (!d) return null;
  try {
    return await deliveryForViewer(ctx, d.id);
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

/** File of a proof of delivery or a failed attempt, for an authorised viewer. */
export async function deliveryFileKey(ctx: Ctx, id: string, which: string): Promise<string> {
  const { d } = await load(ctx, id);
  if (which === "signature" && d.proof?.signatureKey) return d.proof.signatureKey;
  const m = /^photo-(\d+)$/.exec(which);
  if (m && d.proof?.photoKeys[Number(m[1])]) return d.proof.photoKeys[Number(m[1])];
  const a = /^attempt-(\w+)$/.exec(which);
  const att = a ? d.attempts.find((x) => x.id === a[1]) : null;
  if (att?.photoKey) return att.photoKey;
  throw new NotFoundError("File");
}

// ── dispatching ─────────────────────────────────────────────────────────────

export async function assignDelivery(ctx: Ctx, id: string, input: { driverId: string | null; vehicleId?: string | null; scheduledFor?: Date | null; notes?: string | null }) {
  const { d, role } = await load(ctx, id);
  if (role !== "DISPATCHER") throw new ForbiddenError();
  if (d.mode === "CARRIER") throw new ValidationError("This order ships with a carrier — enter the carrier and tracking number instead.");
  if (!["UNASSIGNED", "ASSIGNED", "PICKED_UP", "FAILED"].includes(d.status)) throw new AppError("BAD_TRANSITION", "This delivery can no longer be reassigned.", 409);
  if (!input.driverId && (d.status === "PICKED_UP" || d.status === "FAILED")) throw new ValidationError("Choose a driver.");
  const driver = input.driverId
    ? await prisma.driver.findFirst({ where: { id: input.driverId, ownerCompanyId: d.executingCompanyId, status: "APPROVED" }, include: { user: { select: { name: true } } } })
    : null;
  if (input.driverId && !driver) throw new ValidationError("Choose an active driver from your fleet.");
  const vehicle = input.vehicleId ? await prisma.vehicle.findFirst({ where: { id: input.vehicleId, ownerCompanyId: d.executingCompanyId, status: "ACTIVE" } }) : null;
  if (input.vehicleId && !vehicle) throw new ValidationError("Choose an active vehicle from your fleet.");
  if (driver && driver.id !== d.driverId) await assertDriverCapacity(driver.id, d.executingCompanyId, d.executor.type === "ADMIN", d.id);
  const retry = d.status === "FAILED";
  const nextStatus: DeliveryStatus = retry ? "PICKED_UP" : d.status === "PICKED_UP" ? "PICKED_UP" : driver ? "ASSIGNED" : "UNASSIGNED";
  await prisma.$transaction(async (tx) => {
    await tx.delivery.update({
      where: { id },
      data: {
        driverId: driver?.id ?? null, vehicleId: vehicle?.id ?? null, status: nextStatus,
        scheduledFor: input.scheduledFor === undefined ? d.scheduledFor : input.scheduledFor, notes: input.notes === undefined ? d.notes : input.notes?.trim() || null,
        assignedAt: driver ? new Date() : null, assignedById: ctx.user.id,
      },
    });
    // Handed to another driver by hand: it leaves its route (the route's other stops are re-timed).
    if (d.routeId && driver?.id !== d.driverId) await detachFromRoute(tx, id);
    // Retry after a failed attempt: the goods are still with the fleet → back on the road.
    if (retry && d.order.status === "EXCEPTION")
      await applyOrderTransition(tx, { ...d.order, lines: d.order.lines }, "DISPATCHED", { reason: "New delivery attempt", userId: ctx.user.id, companyId: ctx.company.id, syncDelivery: false });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: retry ? "delivery.retry" : "delivery.assigned", entityType: "Delivery", entityId: id, before: { driverId: d.driverId, vehicleId: d.vehicleId, status: d.status }, after: { driverId: driver?.id ?? null, vehicleId: vehicle?.id ?? null, status: nextStatus } }, tx);
  });
  if (driver && driver.id !== d.driverId) {
    const target = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id }, select: { userId: true } });
    const a = d.order.deliveryAddress as { line1?: string; postalCode?: string; city?: string };
    await notify("delivery.assigned", [{ userId: target.userId, link: `/driver/deliveries/${id}` }], { number: d.order.number, customer: d.order.buyer.tradeName ?? d.order.buyer.legalName, address: `${a.line1 ?? ""}, ${a.postalCode ?? ""} ${a.city ?? ""}` }, { ref: { type: "Delivery", id } });
  }
}

export async function setCarrier(ctx: Ctx, id: string, input: { carrierName: string; trackingNumber?: string | null }) {
  const { d, role } = await load(ctx, id);
  if (role !== "DISPATCHER") throw new ForbiddenError();
  if (d.mode !== "CARRIER") throw new ValidationError("This delivery is not shipped with a carrier.");
  const name = input.carrierName.trim();
  if (name.length < 2) throw new ValidationError("Enter the carrier's name.");
  await prisma.$transaction(async (tx) => {
    await tx.delivery.update({ where: { id }, data: { carrierName: name, trackingNumber: input.trackingNumber?.trim() || null, assignedAt: new Date(), assignedById: ctx.user.id } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "delivery.carrier_set", entityType: "Delivery", entityId: id, after: { carrierName: name, trackingNumber: input.trackingNumber } }, tx);
  });
}

// ── driver steps ────────────────────────────────────────────────────────────

const isImage = (f: File | null | undefined): f is File => !!f && typeof f.arrayBuffer === "function" && f.size > 0;

async function storeImage(file: File, folder: string) {
  const s = await storeUpload(file, folder);
  if (!s.mimeType.startsWith("image/")) throw new ValidationError("Photos and signatures must be images (JPG, PNG or WEBP).");
  return s.key;
}

type Where = { latitude?: number | null; longitude?: number | null };
const coord = (v: number | null | undefined, max: number) => (v == null || !Number.isFinite(v) || Math.abs(v) > max ? null : v.toFixed(6));

async function moveAsDriver(ctx: Ctx, id: string, to: DeliveryStatus, effect?: (tx: Tx, d: DeliveryView) => Promise<void>, reason?: string | null) {
  const { d, role } = await load(ctx, id);
  if (role !== "DRIVER") throw new ForbiddenError();
  if (!can(ctx, "driver.deliveries.update") || (to === "DELIVERED" && !can(ctx, "driver.pod.capture"))) throw new ForbiddenError();
  if (!canMoveDelivery(d.status, to)) throw new AppError("BAD_TRANSITION", "This step is not possible now.", 409);
  if (to === "PICKED_UP" && d.order.status !== "READY_FOR_PICKUP") throw new AppError("NOT_READY", "The supplier hasn't marked this order ready for pickup yet.", 409);
  const orderTo = orderStatusFor(to, d.status);
  if (orderTo && orderTo !== d.order.status && !nextStatuses(d.order.status).includes(orderTo))
    throw new AppError("BAD_TRANSITION", `The order is ${d.order.status.toLowerCase().replace(/_/g, " ")}; this step is not possible.`, 409);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const res = await tx.delivery.updateMany({
      where: { id, status: d.status },
      data: { status: to, ...(to === "PICKED_UP" ? { pickedUpAt: now } : {}), ...(to === "DELIVERED" ? { completedAt: now } : {}) },
    });
    if (res.count !== 1) throw new AppError("CONFLICT", "This delivery was changed by someone else. Please reload.", 409);
    if (effect) await effect(tx, d);
    if (orderTo && orderTo !== d.order.status)
      await applyOrderTransition(tx, d.order, orderTo, { reason, userId: ctx.user.id, companyId: ctx.company.id, syncDelivery: false, exceptionType: to === "FAILED" ? "DELIVERY_FAILED" : undefined });
    if (to === "OUT_FOR_DELIVERY") await tx.driver.update({ where: { id: d.driverId! }, data: { availability: "BUSY" } });
    if (to === "DELIVERED" || to === "FAILED") {
      const more = await tx.delivery.count({ where: { driverId: d.driverId!, status: "OUT_FOR_DELIVERY" } });
      if (!more) await tx.driver.update({ where: { id: d.driverId! }, data: { availability: "AVAILABLE" } });
    }
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `delivery.${to.toLowerCase()}`, entityType: "Delivery", entityId: id, before: { status: d.status }, after: { status: to, reason } }, tx);
  });
  if (to !== "ASSIGNED" && to !== "UNASSIGNED" && to !== "CANCELLED") await onDeliveryStep(id, to);
  if (orderTo && orderTo !== d.order.status) await notifyOrderChange(d.order, orderTo, reason, "SYSTEM");
  if (to === "FAILED" && d.executingCompanyId !== d.order.sellerCompanyId)
    await notify("delivery.failed", [{ companyId: d.executingCompanyId, link: "/admin/delivery/failed" }], { number: d.order.number, reason }, { ref: { type: "Delivery", id } });
  return d;
}

export const pickUp = (ctx: Ctx, id: string) => moveAsDriver(ctx, id, "PICKED_UP");
export const startDelivery = (ctx: Ctx, id: string) => moveAsDriver(ctx, id, "OUT_FOR_DELIVERY");

export async function completeDelivery(ctx: Ctx, id: string, input: Where & { recipientName: string; signature?: File | null; photos?: File[]; note?: string | null }) {
  const name = input.recipientName.trim();
  if (name.length < 2) throw new ValidationError("Enter the name of the person who received the goods.");
  const photos = (input.photos ?? []).filter(isImage);
  if (!isImage(input.signature) && !photos.length) throw new ValidationError("Add the recipient's signature or a photo of the delivered goods.");
  if (photos.length > 4) throw new ValidationError("Up to 4 photos.");
  // Store files first (outside the DB transaction); keys are only referenced if the step succeeds.
  const signatureKey = isImage(input.signature) ? await storeImage(input.signature, "pod") : null;
  const photoKeys: string[] = [];
  for (const p of photos) photoKeys.push(await storeImage(p, "pod"));
  const lat = coord(input.latitude, 90), lng = coord(input.longitude, 180);
  await moveAsDriver(ctx, id, "DELIVERED", async (tx, d) => {
    await tx.deliveryAttempt.create({ data: { deliveryId: d.id, succeeded: true, failureReason: input.note?.trim() || null, latitude: lat, longitude: lng, byUserId: ctx.user.id } });
    await tx.proofOfDelivery.create({ data: { deliveryId: d.id, recipientName: name, signatureKey, photoKeys, latitude: lat, longitude: lng, byUserId: ctx.user.id } });
  });
  (await import("@/server/invoicing/fiscal")).kickFiscalQueue(); // the delivery invoiced the order: send it to Moloni
}

export async function failDelivery(ctx: Ctx, id: string, input: Where & { reasonCode: string; note?: string | null; photo?: File | null }) {
  if (!(FAILURE_REASONS as readonly string[]).includes(input.reasonCode)) throw new ValidationError("Choose why the delivery failed.");
  if (input.reasonCode === "OTHER" && !input.note?.trim()) throw new ValidationError("Describe what happened.");
  const photoKey = isImage(input.photo) ? await storeImage(input.photo, "pod") : null;
  const reason = `Delivery failed: ${(input.reasonCode as FailureReason).toLowerCase().replace(/_/g, " ")}${input.note?.trim() ? ` — ${input.note.trim()}` : ""}`;
  await moveAsDriver(
    ctx, id, "FAILED",
    async (tx, d) => {
      await tx.deliveryAttempt.create({
        data: { deliveryId: d.id, succeeded: false, reasonCode: input.reasonCode, failureReason: input.note?.trim() || null, photoKey, latitude: coord(input.latitude, 90), longitude: coord(input.longitude, 180), byUserId: ctx.user.id },
      });
    },
    reason,
  );
}

/** After a failed delivery the dispatcher sends the goods back: the order is cancelled and stock returns. */
export async function returnToSupplier(ctx: Ctx, id: string, reason: string) {
  const { d, role } = await load(ctx, id);
  if (role !== "DISPATCHER") throw new ForbiddenError();
  if (d.status !== "FAILED") throw new AppError("BAD_TRANSITION", "Only a failed delivery can be returned to the supplier.", 409);
  if (!reason.trim()) throw new ValidationError("Please give a reason.");
  const orderTo: OrderStatus = "CANCELLED";
  if (!nextStatuses(d.order.status).includes(orderTo)) throw new AppError("BAD_TRANSITION", "The order can't be cancelled now.", 409);
  await prisma.$transaction(async (tx) => {
    await tx.delivery.update({ where: { id }, data: { status: "RETURNED", completedAt: new Date() } });
    await applyOrderTransition(tx, d.order, orderTo, { reason: `Returned to supplier after failed delivery: ${reason.trim()}`, userId: ctx.user.id, companyId: ctx.company.id, syncDelivery: false });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "delivery.returned_to_supplier", entityType: "Delivery", entityId: id, after: { reason } }, tx);
  });
  await onDeliveryStep(id, "RETURNED");
  await notifyOrderChange(d.order, orderTo, `Not delivered — returned to the supplier. ${reason.trim()}`, "SYSTEM");
}
