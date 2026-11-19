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
const COMPLIANCE: PermissionCode[] = ["company.documents.manage", "company.profile.manage", "vendor.products.manage"];
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
  // supplier compliance (Phase 28)
  E("compliance.expiring", "account", COMPLIANCE, ["EMAIL"], ["certificate", "days", "date"]),
  E("compliance.expired", "account", COMPLIANCE, ["EMAIL", "PUSH"], ["certificate", "grace"], true),
  E("compliance.paused", "account", COMPLIANCE, ["EMAIL", "PUSH", "WHATSAPP"], ["certificates", "offers"], true),
  E("compliance.resumed", "account", COMPLIANCE, ["EMAIL", "PUSH"], []),
  E("compliance.approved", "account", COMPLIANCE, ["EMAIL"], ["certificate"]),
  E("compliance.rejected", "account", COMPLIANCE, ["EMAIL"], ["certificate", "reason"], true),
  E("compliance.review", "account", ["admin.vendors.approve", "admin.risk.manage"], ["EMAIL"], ["company", "certificate"]),
  E("compliance.recheck", "account", ["admin.vendors.approve", "admin.risk.manage"], ["EMAIL"], ["count"]),
  // price intelligence (Phase 29)
  E("price.change_requested", "catalogue", ["admin.pricing.manage"], ["EMAIL", "PUSH"], ["vendor", "product", "old", "new", "pct"]),
  E("price.change_approved", "catalogue", ["vendor.pricing.manage", "vendor.products.manage"], ["EMAIL"], ["product", "new", "date"]),
  E("price.change_rejected", "catalogue", ["vendor.pricing.manage", "vendor.products.manage"], ["EMAIL"], ["product", "reason"]),
  E("price.review_requested", "catalogue", ["vendor.pricing.manage", "vendor.products.manage"], ["EMAIL", "PUSH"], ["product", "pct", "message"]),
  E("price.increase_notice", "catalogue", [...BUYER_ORDERS, "buyer.catalogue.view"], ["EMAIL", "PUSH"], ["product", "supplier", "old", "new", "date"]),
  E("price.alerts", "catalogue", ["admin.pricing.view", "admin.pricing.manage"], ["PUSH"], ["count"]),
  // demand planning (Phase 30)
  E("planning.restock", "catalogue", ["vendor.purchasing.manage", "vendor.inventory.manage"], ["EMAIL", "PUSH"], ["count", "late"]),
  E("planning.flagged", "catalogue", ["vendor.purchasing.manage", "vendor.inventory.manage"], ["EMAIL", "PUSH"], ["product", "warehouse", "message"]),
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
  E("order.held", "orders", BUYER_ORDERS, ["EMAIL", "PUSH"], ["number"]),
  E("order.released", "orders", BUYER_ORDERS, ["EMAIL", "PUSH"], ["number", "supplier"]),
  E("risk.order_held", "orders", ["admin.risk.manage"], ["EMAIL", "PUSH"], ["number", "company", "score"]),
  E("risk.order_flagged", "orders", ["admin.risk.manage"], ["PUSH"], ["number", "company", "score"]),
  E("approval.requested", "account", ["admin.invoices.issue", "admin.customers.manage", "admin.vendors.commission", "admin.marketing.manage", "admin.pricing.manage", "admin.settings.manage", "admin.users.manage", "admin.finance.manage"], ["EMAIL", "PUSH"], ["kind", "summary", "by"]),
  E("approval.decided", "account", null, ["EMAIL", "PUSH"], ["kind", "summary", "decision", "reason"]),
  E("invoicing.failed", "finance", ["admin.finance.manage", "admin.invoices.issue"], ["EMAIL", "PUSH"], ["number", "reason"]),
  E("payout.due", "finance", ["admin.finance.manage"], ["EMAIL", "PUSH"], ["count", "amount", "overdue"]),
  E("ops.alert", "account", null, ["EMAIL", "PUSH", "WHATSAPP", "SMS"], ["severity", "title", "detail"], true),
  E("ops.resolved", "account", null, ["EMAIL", "PUSH"], ["title"]),
  // unsold goods bought on FIRINGI near their best-before (wholesalers and customers; FIRINGI sets the days)
  E("inventory.expiring", "orders", ["buyer.orders.view", "buyer.orders.place", "vendor.inventory.view", "vendor.inventory.manage"], ["EMAIL", "PUSH"], ["count", "days", "products"]),
  // product recalls (Phase 25): every buyer down the chain is told; the supplier / FIRINGI when the other one starts it
  E("recall.notice", "orders", ["buyer.orders.view", "buyer.orders.place", "vendor.inventory.view", "vendor.inventory.manage"], ["EMAIL", "SMS", "WHATSAPP", "PUSH"], ["number", "product", "lot", "reason"], true),
  E("recall.started", "catalogue", ["vendor.recalls.manage", "vendor.inventory.manage", "admin.recalls.manage", "admin.inventory.view"], ["EMAIL", "PUSH"], ["number", "product", "lot", "units", "buyers"], true),
  // B2B buying (Phase 26): quotes, the buyer's own approvals, recurring orders
  E("quote.requested", "orders", ["vendor.pricing.manage", ...VENDOR_ORDERS], ["EMAIL", "PUSH"], ["number", "buyer", "lines"]),
  E("quote.answered", "orders", BUYER_ORDERS, ["EMAIL", "PUSH"], ["number", "supplier", "until"]),
  E("quote.declined", "orders", BUYER_ORDERS, ["EMAIL"], ["number", "supplier", "reason"]),
  E("buyer_approval.pending", "orders", ["buyer.orders.approve"], ["EMAIL", "PUSH"], ["requester", "total"]),
  E("buyer_approval.approved", "orders", null, ["EMAIL", "PUSH"], ["orders"]),
  E("buyer_approval.rejected", "orders", null, ["EMAIL", "PUSH"], ["reason"]),
  E("recurring.reminder", "orders", null, ["EMAIL", "PUSH"], ["name", "date", "problems"]),
  E("recurring.placed", "orders", null, ["PUSH"], ["name", "orders"]),
  E("recurring.failed", "orders", null, ["EMAIL", "PUSH"], ["name", "reason"]),
  E("budget.threshold", "orders", ["buyer.branches.manage"], ["EMAIL", "PUSH"], ["name", "pct", "spent", "amount"]),
  E("ai.stock_low", "catalogue", ["vendor.stock.manage", "vendor.products.manage"], ["EMAIL", "PUSH"], ["product", "days", "available"]),
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
  // quality claims (Phase 31)
  E("claim.opened", "returns", ["admin.claims.manage", "vendor.claims.respond"], ["EMAIL", "PUSH"], ["number", "order", "reason"]),
  E("claim.message", "returns", ["admin.claims.manage", "vendor.claims.respond", "buyer.claims.manage"], ["EMAIL", "PUSH"], ["number"]),
  E("claim.supplier_responded", "returns", ["admin.claims.manage"], ["EMAIL", "PUSH"], ["number", "response"]),
  E("claim.answer_needed", "returns", ["vendor.claims.respond"], ["EMAIL", "PUSH"], ["number"]),
  E("claim.decided", "returns", ["buyer.claims.manage", "buyer.orders.view", "vendor.claims.respond"], ["EMAIL", "PUSH"], ["number", "decision", "note"]),
  E("claim.replaced", "returns", ["buyer.claims.manage", "buyer.orders.view"], ["EMAIL", "PUSH"], ["number"]),
  E("claim.chargeback", "returns", ["vendor.claims.respond", "vendor.invoices.view"], ["EMAIL"], ["number"]),
  E("claim.chargeback_disputed", "returns", ["admin.claims.manage"], ["EMAIL"], ["number"]),
  E("claim.chargeback_resolved", "returns", ["vendor.claims.respond", "vendor.invoices.view"], ["EMAIL"], ["number", "decision"]),
  E("claim.overdue", "returns", ["admin.claims.manage"], ["EMAIL", "PUSH"], ["count"]),
  E("quality.alert", "returns", ["admin.claims.manage", "vendor.claims.respond"], ["EMAIL", "PUSH"], ["label", "value", "threshold"]),
  // loyalty & rewards (Phase 32)
  E("loyalty.tier_up", "account", BUYER_ORDERS, ["EMAIL", "PUSH"], ["tier"]),
  E("loyalty.expiring", "account", BUYER_ORDERS, ["EMAIL"], ["points", "date"]),
  E("loyalty.referral", "account", BUYER_ORDERS, ["EMAIL", "PUSH"], ["points", "company"]),
  // advertising (Phase 34)
  E("ads.approved", "account", ["vendor.promotions.manage"], ["EMAIL", "PUSH"], ["campaign"]),
  E("ads.rejected", "account", ["vendor.promotions.manage"], ["EMAIL", "PUSH"], ["campaign", "reason"]),
  E("ads.stopped", "account", ["vendor.promotions.manage"], ["EMAIL", "PUSH"], ["campaign", "reason"]),
  E("ads.low_balance", "account", ["vendor.promotions.manage", "vendor.invoices.view"], ["EMAIL"], ["balance"]),
  // supplier plans & early payout (Phase 36)
  E("plan.trial_ending", "account", ["company.profile.manage", "vendor.invoices.view"], ["EMAIL", "PUSH"], ["plan", "days", "date"]),
  E("plan.trial_ended", "account", ["company.profile.manage", "vendor.invoices.view"], ["EMAIL"], ["plan"]),
  E("plan.changed", "account", ["company.profile.manage", "vendor.invoices.view"], ["EMAIL"], ["plan", "date"]),
  E("earlypay.paid", "finance", ["vendor.invoices.view", "vendor.payments.view"], ["EMAIL", "PUSH"], ["number", "net"]),
  E("earlypay.rejected", "finance", ["vendor.invoices.view", "vendor.payments.view"], ["EMAIL", "PUSH"], ["number", "reason"]),
  E("earlypay.requested", "finance", ["admin.finance.manage"], ["EMAIL", "PUSH"], ["company", "number", "amount"]),
  // returnables & deposits (Phase 40)
  E("returnables.collected", "orders", ["vendor.orders.manage"], ["EMAIL", "PUSH"], ["number", "customer", "units"]),
  E("returnables.confirmed", "orders", ["buyer.orders.view", "buyer.invoices.view"], ["EMAIL", "PUSH"], ["number", "accepted", "damaged", "missing", "credit"]),
  E("returnables.disputed", "orders", ["admin.orders.manage", "vendor.orders.manage"], ["EMAIL"], ["number", "customer"]),
  E("returnables.resolved", "orders", ["buyer.orders.view", "vendor.orders.manage"], ["EMAIL", "PUSH"], ["number", "note"]),
  E("returnables.pickup_requested", "orders", ["vendor.orders.manage"], ["EMAIL", "PUSH"], ["number", "customer", "units"]),
  E("returnables.pickup_planned", "orders", ["buyer.orders.place", "buyer.orders.view"], ["EMAIL", "PUSH"], ["number", "date"]),
  E("returnables.overdue", "orders", ["buyer.orders.place", "buyer.orders.view"], ["EMAIL", "PUSH"], ["supplier", "items", "days"]),
  E("returnables.kept", "orders", ["buyer.orders.view", "vendor.orders.manage"], ["EMAIL", "PUSH"], ["customer", "supplier", "items", "days"]),
  // cold chain (Phase 42)
  E("coldchain.breach", "orders", ["vendor.orders.manage", "admin.orders.manage"], ["EMAIL", "PUSH"], ["number", "incident", "temp", "range", "stage", "decision"]),
  E("coldchain.logger_alert", "deliveries", ["vendor.vehicles.manage", "vendor.inventory.manage", "admin.fleet.manage"], ["EMAIL", "PUSH", "SMS"], ["logger", "minutes", "temp", "range"]),
  E("coldchain.equipment_due", "deliveries", ["vendor.vehicles.manage", "vendor.inventory.manage", "admin.fleet.manage"], ["EMAIL", "PUSH"], ["equipment", "tasks"]),
  E("excise.licence_review", "account", ["admin.customers.manage", "admin.vendors.approve"], ["EMAIL", "PUSH"], ["company", "licence"]),
  E("excise.licence_decided", "account", ["company.documents.manage", "buyer.orders.place"], ["EMAIL", "PUSH"], ["licence", "status", "note"]),
  E("excise.licence_expiring", "account", ["company.documents.manage", "buyer.orders.place"], ["EMAIL", "PUSH"], ["licence", "date", "days"]),
  // sold by weight (Phase 41)
  E("catchweight.over_limit", "orders", ["buyer.orders.place", "buyer.orders.view"], ["EMAIL", "PUSH"], ["number", "product", "weighed", "max"]),
  E("catchweight.over_accepted", "orders", ["vendor.orders.manage"], ["EMAIL", "PUSH"], ["number"]),
  // clearance deals (Phase 38)
  E("deal.review", "catalogue", ["admin.pricing.manage", "admin.marketing.manage"], ["EMAIL"], ["company", "number"]),
  E("deal.approved", "catalogue", ["vendor.promotions.manage", "vendor.pricing.manage"], ["EMAIL", "PUSH"], ["number"]),
  E("deal.rejected", "catalogue", ["vendor.promotions.manage", "vendor.pricing.manage"], ["EMAIL", "PUSH"], ["number", "reason"]),
  E("deal.bid", "catalogue", ["vendor.promotions.manage", "vendor.pricing.manage"], ["EMAIL", "PUSH"], ["number", "qty", "price"]),
  E("deal.bid_accepted", "orders", ["buyer.orders.place", "buyer.orders.view"], ["EMAIL", "PUSH"], ["number", "price"]),
  E("deal.bid_rejected", "orders", ["buyer.orders.place", "buyer.orders.view"], ["EMAIL", "PUSH"], ["number", "price"]),
  E("deal.bid_countered", "orders", ["buyer.orders.place", "buyer.orders.view"], ["EMAIL", "PUSH"], ["number", "price"]),
  E("deal.alert", "catalogue", ["buyer.orders.place", "buyer.catalogue.view"], ["EMAIL", "PUSH"], ["product", "supplier", "pct", "until"]),
  E("deal.digest", "catalogue", ["buyer.orders.place", "buyer.catalogue.view"], ["EMAIL"], ["count", "products"]),
  // bank reconciliation (Phase 37)
  E("bank.to_review", "finance", ["admin.finance.manage"], ["EMAIL"], ["count", "oldest"]),
  E("bank.feed_expiring", "finance", ["company.bank.manage", "admin.finance.manage"], ["EMAIL", "PUSH"], ["account", "date"]),
  E("bank.feed_failed", "finance", ["company.bank.manage", "admin.finance.manage"], ["EMAIL"], ["account", "reason"]),
  // order chat (Phase 35)
  E("chat.message", "orders", [...ORDERS, "admin.orders.manage", "admin.support.manage", "driver.deliveries.view"], ["EMAIL", "PUSH"], ["number", "from"]),
  // finance
  E("invoice.credit_note", "finance", ["buyer.invoices.view", "buyer.orders.view"], ["EMAIL"], ["document"]),
  // online payments (Phase 20) — {total} is shown in the reader's currency format
  E("integration.feed_held", "catalogue", ["vendor.products.manage", "vendor.pricing.manage", "vendor.stock.manage"], ["EMAIL", "PUSH"], ["name", "reason"]),
  E("integration.feed_failed", "catalogue", ["vendor.products.manage", "vendor.pricing.manage", "vendor.stock.manage"], ["EMAIL", "PUSH"], ["name", "reason"]),
  E("integration.webhook_disabled", "account", ["company.integrations.manage"], ["EMAIL"], ["url", "reason"]),
  E("payment.received", "finance", ["buyer.invoices.view", "buyer.payments.view"], ["EMAIL", "PUSH"], ["total", "documents"]),
  E("payment.failed", "finance", ["buyer.invoices.view", "buyer.payments.view"], ["EMAIL", "PUSH"], ["total", "reason"]),
  E("payment.refunded", "finance", ["buyer.invoices.view", "buyer.payments.view"], ["EMAIL"], ["total"]),
  E("payment.link", "finance", ["buyer.invoices.view", "buyer.payments.view"], ["EMAIL", "WHATSAPP"], ["total", "documents"]),
  E("payment.reminder_soon", "finance", ["buyer.invoices.view", "buyer.payments.view"], ["EMAIL"], ["total", "documents", "due"]),
  E("payment.reminder_due", "finance", ["buyer.invoices.view", "buyer.payments.view"], ["EMAIL", "PUSH"], ["total", "documents"]),
  E("payment.reminder_overdue", "finance", ["buyer.invoices.view", "buyer.payments.view"], ["EMAIL", "WHATSAPP"], ["total", "documents", "days"]),
  E("direct_debit.notice", "finance", ["buyer.invoices.view", "buyer.payments.view"], ["EMAIL"], ["total", "documents", "date"]),
  E("direct_debit.active", "finance", ["buyer.payments.make", "buyer.payments.view"], ["EMAIL"], ["last4"]),
  E("order.awaiting_payment", "orders", ["buyer.orders.place", "buyer.payments.make"], ["EMAIL", "PUSH"], ["number", "total"]),
  E("order.cancelled_unpaid", "orders", ["buyer.orders.place", "buyer.orders.view"], ["EMAIL"], ["number"]),
  E("payment.attention", "finance", ["admin.finance.manage"], ["EMAIL", "PUSH"], ["company", "total", "reason"]),
  E("vendor_invoice.approved", "finance", ["vendor.invoices.view", "vendor.invoices.submit"], ["EMAIL"], ["document"], true),
  E("vendor_invoice.rejected", "finance", ["vendor.invoices.view", "vendor.invoices.submit"], ["EMAIL"], ["document", "reason"], true),
  // support & CRM
  E("support.new", "account", ["admin.support.manage"], ["EMAIL", "PUSH"], ["number", "company", "subject"]),
  E("support.message", "account", ["admin.support.manage"], ["PUSH"], ["number", "company"]),
  E("support.reply", "account", null, ["EMAIL", "PUSH"], ["number", "subject"]),
  E("support.resolved", "account", null, ["EMAIL"], ["number", "subject"]),
  E("crm.task_assigned", "account", ["admin.crm.view", "admin.crm.manage"], ["PUSH"], ["title", "due"]),
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
