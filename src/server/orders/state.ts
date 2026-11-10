/**
 * Order status machine (pure). Who may move an order from one status to another.
 *
 *   NEW → (ON_HOLD →) PENDING_CONFIRMATION → SUPPLIER_PROCESSING → READY_FOR_PICKUP → DISPATCHED
 *       → OUT_FOR_DELIVERY → DELIVERED   (+ CANCELLED, RETURNED, EXCEPTION)
 *
 * Dispatch / delivery steps are done by whoever delivers: the vendor for VENDOR_FLEET
 * and CARRIER orders, FIRINGI for FIRINGI_FLEET orders (drivers join in Phase 6).
 * FIRINGI admins (orders.manage) may perform every allowed transition.
 * ON_HOLD: FIRINGI's risk checks hold the order before the supplier sees it; FIRINGI releases
 * it (→ PENDING_CONFIRMATION) or cancels it; the buyer may cancel it.
 */
import type { DeliveryMode, OrderStatus } from "@prisma/client";

export type Actor = "BUYER" | "VENDOR" | "ADMIN" | "SYSTEM";

const FLOW: Partial<Record<OrderStatus, OrderStatus[]>> = {
  NEW: ["PENDING_CONFIRMATION", "ON_HOLD", "CANCELLED"],
  ON_HOLD: ["PENDING_CONFIRMATION", "CANCELLED"],
  PENDING_CONFIRMATION: ["SUPPLIER_PROCESSING", "CANCELLED", "EXCEPTION"],
  SUPPLIER_PROCESSING: ["READY_FOR_PICKUP", "CANCELLED", "EXCEPTION"],
  READY_FOR_PICKUP: ["DISPATCHED", "EXCEPTION"],
  DISPATCHED: ["OUT_FOR_DELIVERY", "EXCEPTION"],
  OUT_FOR_DELIVERY: ["DELIVERED", "EXCEPTION"],
  DELIVERED: ["RETURNED"],
  EXCEPTION: ["PENDING_CONFIRMATION", "SUPPLIER_PROCESSING", "READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"],
};

export function nextStatuses(from: OrderStatus): OrderStatus[] {
  return FLOW[from] ?? [];
}

const DELIVERY_STEPS: OrderStatus[] = ["DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"];

export function canTransition(from: OrderStatus, to: OrderStatus, actor: Actor, mode: DeliveryMode | null): boolean {
  if (!nextStatuses(from).includes(to)) return false;
  if (actor === "ADMIN") return true;
  if (actor === "SYSTEM") return from === "NEW" && (to === "PENDING_CONFIRMATION" || to === "ON_HOLD");
  if (actor === "BUYER") return to === "CANCELLED" && (from === "NEW" || from === "ON_HOLD" || from === "PENDING_CONFIRMATION");
  if (from === "ON_HOLD") return false; // only FIRINGI (or the buyer, cancelling) acts on a held order
  // VENDOR
  if (from === "EXCEPTION" || to === "EXCEPTION" || to === "RETURNED") return false; // FIRINGI handles exceptions & returns
  if (to === "CANCELLED") return from === "PENDING_CONFIRMATION"; // vendor declines before accepting
  if (to === "SUPPLIER_PROCESSING" || to === "READY_FOR_PICKUP") return true;
  if (DELIVERY_STEPS.includes(to)) return mode === "VENDOR_FLEET" || mode === "CARRIER";
  return false;
}

/** Statuses after which the order can no longer change commercially. */
export const CLOSED: OrderStatus[] = ["DELIVERED", "CANCELLED", "RETURNED"];
/** Stock is reserved from placement until dispatch (then shipped) or cancellation (then released). */
export const RESERVED_STATUSES: OrderStatus[] = ["NEW", "ON_HOLD", "PENDING_CONFIRMATION", "SUPPLIER_PROCESSING", "READY_FOR_PICKUP"];
