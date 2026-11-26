/**
 * Printing (a Services kind): what print suppliers offer, the price of an order (per item + setup, minimum and step
 * quantities, or a quote) and the order steps. No server imports.
 */
export const PRINT_KINDS = ["SHELF_LABELS", "LEAFLET", "MENU", "POSTER", "STICKER", "BUSINESS_CARD", "BANNER", "OTHER"] as const;
export type PrintKind = (typeof PRINT_KINDS)[number];
export const PRINT_DELIVERY = ["DELIVERY", "PICKUP"] as const;
export type PrintDelivery = (typeof PRINT_DELIVERY)[number];
/** REQUESTED → (QUOTED →) ACCEPTED → PRINTING → DELIVERED; REJECTED / CANCELLED end it */
export const PRINT_STATUSES = ["REQUESTED", "QUOTED", "ACCEPTED", "PRINTING", "DELIVERED", "REJECTED", "CANCELLED"] as const;
export type PrintStatus = (typeof PRINT_STATUSES)[number];
export const PRINT_OPEN: PrintStatus[] = ["REQUESTED", "QUOTED", "ACCEPTED", "PRINTING"];

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Is this quantity allowed (at least the minimum, in steps)? */
export function qtyOk(p: { minQty: number; stepQty: number }, qty: number) {
  if (!Number.isInteger(qty) || qty < Math.max(1, p.minQty) || qty > 1_000_000) return false;
  const step = Math.max(1, p.stepQty);
  return (qty - Math.max(1, p.minQty)) % step === 0 || qty % step === 0;
}
/** The nearest allowed quantity at or above `qty`. */
export function roundQty(p: { minQty: number; stepQty: number }, qty: number) {
  const min = Math.max(1, p.minQty), step = Math.max(1, p.stepQty);
  if (qty <= min) return min;
  return Math.ceil(qty / step) * step;
}
/** The customer's price excl. VAT for a fixed-price product: setup + per item × quantity. */
export function printPrice(p: { unitPriceNet: number; setupNet: number }, qty: number) {
  return r2(p.setupNet + p.unitPriceNet * qty);
}
/** Who gets what when an order is delivered (FIRINGI invoices: the supplier's amount; the supplier invoices: FIRINGI's commission). */
export function printMoney(priceNet: number, commissionPct: number, by: "FIRINGI" | "PROVIDER") {
  const c = r2((priceNet * commissionPct) / 100);
  return by === "PROVIDER" ? { provider: 0, commission: c } : { provider: r2(priceNet - c), commission: 0 };
}
/** The steps a supplier / customer may take from a status. */
export function nextSteps(status: string, side: "PROVIDER" | "CUSTOMER", priceOnRequest: boolean): string[] {
  if (side === "CUSTOMER") return status === "QUOTED" ? ["ACCEPT_QUOTE", "CANCEL"] : status === "REQUESTED" || status === "ACCEPTED" ? ["CANCEL"] : [];
  switch (status) {
    case "REQUESTED": return priceOnRequest ? ["QUOTE", "REJECT"] : ["ACCEPT", "QUOTE", "REJECT"];
    case "QUOTED": return ["QUOTE", "REJECT"];
    case "ACCEPTED": return ["PRINTING", "DELIVERED", "REJECT"];
    case "PRINTING": return ["DELIVERED"];
    default: return [];
  }
}
