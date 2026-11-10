/**
 * Notification event catalogue (pure). Every message FIRINGI sends starts from one of these.
 *
 *   category  — what users can switch on/off per channel in their preferences
 *   perms     — when sent to a company: members holding ANY of these get it (owners always);
 *               null = every active member (account events, sent before approval too)
 *   channels  — default channels besides IN_APP (always on); FIRINGI can change them per event
 *   critical  — users can't switch e-mail / in-app off (account, compliance, finance decisions)
 *   vars      — placeholders, in this order (= WhatsApp template body parameters)
 * Default texts: src/messages/<locale>.json → notify.<event key with "." → "_">.title / .body
 */
import type { NotificationChannel } from "@prisma/client";
import type { PermissionCode } from "@/server/rbac/permissions";

export const CATEGORIES = ["orders", "deliveries", "returns", "finance", "catalogue", "account"] as const;
export type Category = (typeof CATEGORIES)[number];
export const OPTIONAL_CHANNELS: NotificationChannel[] = ["EMAIL", "SMS", "WHATSAPP", "PUSH"];

export type EventDef = {
  key: string;
  category: Category;
  perms: PermissionCode[] | null;
  channels: NotificationChannel[];
  critical?: boolean;
  vars: string[];
};

const BUYER_ORDERS: PermissionCode[] = ["buyer.orders.view", "buyer.orders.place"];
const VENDOR_ORDERS: PermissionCode[] = ["vendor.orders.view", "vendor.orders.manage"];
const ORDERS: PermissionCode[] = [...BUYER_ORDERS, ...VENDOR_ORDERS];
const E = (key: string, category: Category, perms: PermissionCode[] | null, channels: NotificationChannel[], vars: string[], critical = false): EventDef => ({ key, category, perms, channels, vars, critical });

export const EVENTS: EventDef[] = [
  // account & compliance (critical)
  E("company.under_review", "account", null, ["EMAIL"], [], true),
  E("company.approved", "account", null, ["EMAIL", "WHATSAPP"], [], true),
  E("company.rejected", "account", null, ["EMAIL"], ["reason"], true),
  E("company.suspended", "account", null, ["EMAIL"], ["reason"], true),
  E("company.pending", "account", null, ["EMAIL"], ["reason"], true),
  E("driver.approved", "account", null, ["EMAIL", "SMS"], [], true),
  E("driver.rejected", "account", null, ["EMAIL"], ["reason"], true),
  E("driver.suspended", "account", null, ["EMAIL", "SMS"], ["reason"], true),
  E("document.rejected", "account", null, ["EMAIL"], ["document", "reason"], true),
  E("restriction.approved", "account", null, ["EMAIL"], ["restriction", "until"], true),
  E("restriction.rejected", "account", null, ["EMAIL"], ["restriction", "reason"], true),
  E("restriction.revoked", "account", null, ["EMAIL"], ["restriction", "reason"], true),
  // catalogue
  E("product.approved", "catalogue", ["vendor.products.view", "vendor.products.manage"], ["EMAIL"], ["product"]),
  E("product.rejected", "catalogue", ["vendor.products.view", "vendor.products.manage"], ["EMAIL"], ["product", "reason"]),
  E("offer.rejected", "catalogue", ["vendor.products.view", "vendor.products.manage"], ["EMAIL"], ["product", "reason"]),
  E("offer.suspended", "catalogue", ["vendor.products.view", "vendor.products.manage"], ["EMAIL"], ["product", "reason"]),
  // orders
  E("order.new", "orders", VENDOR_ORDERS, ["EMAIL", "WHATSAPP", "PUSH"], ["number", "buyer", "total"]),
  E("order.confirmed", "orders", BUYER_ORDERS, ["EMAIL", "WHATSAPP", "PUSH"], ["number", "supplier"]),
  E("order.ready_for_pickup", "orders", ORDERS, ["PUSH"], ["number"]),
  E("order.dispatched", "orders", ORDERS, ["EMAIL", "PUSH"], ["number"]),
  E("order.out_for_delivery", "orders", ORDERS, ["EMAIL", "WHATSAPP", "SMS", "PUSH"], ["number"]),
  E("order.delivered", "orders", ORDERS, ["EMAIL", "WHATSAPP", "PUSH"], ["number"]),
  E("order.cancelled", "orders", ORDERS, ["EMAIL", "WHATSAPP", "PUSH"], ["number", "reason"]),
  E("order.exception", "orders", [...ORDERS, "admin.orders.manage"], ["EMAIL", "PUSH"], ["number", "reason"]),
  E("order.returned", "orders", ORDERS, ["EMAIL"], ["number", "reason"]),
  E("order.reallocated", "orders", BUYER_ORDERS, ["EMAIL", "WHATSAPP", "PUSH"], ["number", "newNumber", "supplier"]),
  E("order.supplier_unavailable", "orders", BUYER_ORDERS, ["EMAIL", "WHATSAPP", "PUSH"], ["number", "supplier"]),
  E("allocation.needed", "orders", ["admin.allocation.manage"], ["EMAIL", "PUSH"], ["number", "reason"]),
  // deliveries
  E("delivery.assigned", "deliveries", ["driver.deliveries.view"], ["SMS", "WHATSAPP", "PUSH"], ["number", "customer", "address"]),
  E("delivery.eta", "deliveries", BUYER_ORDERS, ["WHATSAPP", "SMS", "PUSH"], ["number", "from", "to"]),
  E("route.assigned", "deliveries", ["driver.deliveries.view"], ["SMS", "WHATSAPP", "PUSH"], ["number", "stops", "date"]),
  E("delivery.failed", "deliveries", ["admin.delivery.view", "admin.delivery.manage", "vendor.orders.manage"], ["EMAIL", "PUSH"], ["number", "reason"]),
  // returns
  E("return.requested", "returns", ["admin.orders.manage", "admin.delivery.view", ...VENDOR_ORDERS], ["EMAIL"], ["number", "reason"]),
  E("return.approved", "returns", ORDERS, ["EMAIL", "WHATSAPP"], ["number"]),
  E("return.rejected", "returns", BUYER_ORDERS, ["EMAIL"], ["number", "reason"]),
  E("return.credited", "returns", [...BUYER_ORDERS, "buyer.invoices.view"], ["EMAIL"], ["number"]),
  // finance
  E("invoice.credit_note", "finance", ["buyer.invoices.view", "buyer.orders.view"], ["EMAIL"], ["document"]),
  E("vendor_invoice.approved", "finance", ["vendor.invoices.view", "vendor.invoices.submit"], ["EMAIL"], ["document"], true),
  E("vendor_invoice.rejected", "finance", ["vendor.invoices.view", "vendor.invoices.submit"], ["EMAIL"], ["document", "reason"], true),
  E("promotion.acceptance", "finance", ["vendor.promotions.manage"], ["EMAIL"], ["promotion", "share"]),
];

export const EVENT_KEYS = EVENTS.map((e) => e.key);
const BY_KEY = new Map(EVENTS.map((e) => [e.key, e]));
export function eventDef(key: string): EventDef {
  const e = BY_KEY.get(key);
  if (!e) throw new Error(`Unknown notification event: ${key}`);
  return e;
}
/** Message-file key of an event: "order.out_for_delivery" → "order_out_for_delivery". */
export const messageKey = (eventKey: string) => eventKey.replace(/\./g, "_");

/** Replace {name} placeholders; unknown placeholders are left empty. */
export function fill(text: string, vars: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] == null ? "" : String(vars[k]))).replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
}

/**
 * Which channels a message for this event goes out on, for one user.
 *   eventChannels — the event's channels (default, or FIRINGI's override)
 *   enabledGlobally — channels switched on platform-wide
 *   prefs — the user's choices for this category (undefined = default on)
 */
export function channelsFor(
  def: EventDef,
  eventChannels: NotificationChannel[],
  enabledGlobally: Set<NotificationChannel>,
  prefs: Partial<Record<NotificationChannel, boolean>>,
): NotificationChannel[] {
  const out: NotificationChannel[] = ["IN_APP"];
  for (const c of OPTIONAL_CHANNELS) {
    if (!eventChannels.includes(c) || !enabledGlobally.has(c)) continue;
    if (prefs[c] === false && !(def.critical && c === "EMAIL")) continue;
    out.push(c);
  }
  return out;
}

/** E.164 phone check (+ country code, 8–15 digits). */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(/[\s().-]/g, "");
  const e = s.startsWith("00") ? `+${s.slice(2)}` : s;
  return /^\+[1-9]\d{7,14}$/.test(e) ? e : null;
}
