/**
 * Delivery status machine (pure) and how each step moves the order.
 *
 *   UNASSIGNED → ASSIGNED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
 *                              ↑              │
 *                              │  retry       ▼
 *                              └────────── FAILED ──→ RETURNED (goods back to the supplier)
 *   UNASSIGNED / ASSIGNED → CANCELLED (order cancelled before pick-up)
 *
 * Order side: PICKED_UP → DISPATCHED, OUT_FOR_DELIVERY → OUT_FOR_DELIVERY,
 * DELIVERED → DELIVERED (invoice), FAILED → EXCEPTION, retry → DISPATCHED,
 * RETURNED → CANCELLED (stock goes back).
 */
import type { DeliveryStatus, OrderStatus } from "@prisma/client";

const FLOW: Partial<Record<DeliveryStatus, DeliveryStatus[]>> = {
  UNASSIGNED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["ASSIGNED", "UNASSIGNED", "PICKED_UP", "CANCELLED"],
  PICKED_UP: ["OUT_FOR_DELIVERY", "FAILED", "PICKED_UP"],
  OUT_FOR_DELIVERY: ["DELIVERED", "FAILED"],
  FAILED: ["PICKED_UP", "RETURNED"],
};

export function canMoveDelivery(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return (FLOW[from] ?? []).includes(to);
}

/** Order status each delivery step leads to (null = order unchanged). */
export function orderStatusFor(to: DeliveryStatus, from: DeliveryStatus): OrderStatus | null {
  switch (to) {
    case "PICKED_UP":
      return from === "ASSIGNED" || from === "FAILED" ? "DISPATCHED" : null;
    case "OUT_FOR_DELIVERY":
      return "OUT_FOR_DELIVERY";
    case "DELIVERED":
      return "DELIVERED";
    case "FAILED":
      return "EXCEPTION";
    case "RETURNED":
      return "CANCELLED";
    default:
      return null;
  }
}

/** The delivery status that follows when someone moves the ORDER by hand (keeps both in sync). */
export function deliveryStatusForOrder(order: OrderStatus, current: DeliveryStatus): DeliveryStatus | null {
  const open = current === "UNASSIGNED" || current === "ASSIGNED";
  switch (order) {
    case "DISPATCHED":
      return open || current === "FAILED" ? "PICKED_UP" : null;
    case "OUT_FOR_DELIVERY":
      return open || current === "PICKED_UP" || current === "FAILED" ? "OUT_FOR_DELIVERY" : null;
    case "DELIVERED":
      return current === "DELIVERED" ? null : "DELIVERED";
    case "CANCELLED":
      return open ? "CANCELLED" : current === "FAILED" || current === "PICKED_UP" || current === "OUT_FOR_DELIVERY" ? "RETURNED" : null;
    default:
      return null;
  }
}

export const FAILURE_REASONS = ["CUSTOMER_ABSENT", "CLOSED", "REFUSED", "WRONG_ADDRESS", "DAMAGED", "NO_ACCESS", "TEMPERATURE", "OTHER"] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

/** Delivery statuses where the driver still has work. */
export const ACTIVE_DELIVERY: DeliveryStatus[] = ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"];

/** What the driver can do next on this delivery. */
export function driverActions(status: DeliveryStatus, orderStatus: OrderStatus): ("PICK_UP" | "START" | "DELIVER" | "FAIL")[] {
  if (status === "ASSIGNED") return orderStatus === "READY_FOR_PICKUP" ? ["PICK_UP"] : [];
  if (status === "PICKED_UP") return ["START", "FAIL"];
  if (status === "OUT_FOR_DELIVERY") return ["DELIVER", "FAIL"];
  return [];
}
