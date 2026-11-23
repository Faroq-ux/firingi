/**
 * The AI Business Assistant's tools — for FIRINGI staff, and the support & sales agent for customers
 * and suppliers. All run with the asking user's own context (so the normal permission and visibility
 * rules apply), and each is offered only on the sides that may use it. Buyers never get commission,
 * supplier payouts or other buyers' data: their tools go through the buyer-facing services.
 * Read-only, except `add_to_cart` (the customer asked; it only fills the cart — the customer checks it
 * and places the order) and `handover` (only offers a button: the person sends it to FIRINGI support).
 */
import "server-only";
import { z } from "zod";
import type { Ctx } from "@/server/context";
import { pickLocalized } from "@/i18n/config";
import { analyticsScope, assertAllowed, kpis, labelsFor, periodFrom, previousPeriod, report, type Dim, type Metric } from "@/server/analytics/engine";
import { deliveryRisk, demandForecast, marginOpportunities, reorderPredictions, stockPredictions, supplierRecommendations, type Side } from "./insights";
import { listRecommendations } from "./feed";

const PERIODS = ["7d", "30d", "90d", "12m", "mtd", "lastmonth", "ytd"] as const;
const audienceOf = (side: Side) => (side === "STAFF" ? "ADMIN" : side);

type ToolDef<T> = {
  name: string;
  sides: Side[];
  description: string;
  /** JSON schema sent to Claude (strict: every property required, no extra properties). */
  properties: Record<string, unknown>;
  input: z.ZodType<T>;
  /** Phase 58: only in these channels (default: everywhere) */
  channels?: Channel[];
  run: (ctx: Ctx, side: Side, input: T, locale: string, extra: ToolExtra) => Promise<unknown>;
};
export type Channel = "WEB" | "WHATSAPP";
/** Phase 58: what a tool knows about the conversation (the WhatsApp number it runs for). */
export type ToolExtra = { channel: Channel; waNumber?: string | null; conversationId?: string | null };
/** A tool result may carry a small `card` the chat shows (cart line added, hand-over offered). */
export type ToolCard = { kind: "cart"; product: string; pack: string; qty: number; cartQty: number } | { kind: "handover"; subject: string; summary: string; category: string } | { kind: "proposal"; draftId: string };
const tool = <T,>(t: ToolDef<T>) => t as unknown as ToolDef<unknown>;

const period = { type: "string", enum: [...PERIODS], description: "7d, 30d, 90d, 12m (last 12 months), mtd (this month), lastmonth, ytd (this year)" };
const limit = { type: "integer", description: "How many rows to return (1–50). Use 10 unless you need more." };
const lim = z.number().int().transform((n) => Math.max(1, Math.min(50, n)));

export const TOOLS: ToolDef<unknown>[] = [
  tool({
    name: "sales_summary", sides: ["STAFF", "VENDOR", "BUYER"],
    description: "Headline numbers for a period: orders, amounts, average order, cancellations — with the previous period for comparison. Staff: the whole marketplace (incl. FIRINGI's commission and margin). Supplier: its own sales and payout. Buyer: its own purchases.",
    properties: { period, compare_previous: { type: "boolean", description: "Also return the same-length period before" } },
    input: z.object({ period: z.enum(PERIODS), compare_previous: z.boolean() }),
    run: async (ctx, side, i) => {
      const aud = audienceOf(side);
      const scope = await analyticsScope(ctx, aud);
      const p = periodFrom(i.period);
      const f = { from: p.from, to: p.to, basis: "placed" as const, ...scope };
      const shape = (k: Awaited<ReturnType<typeof kpis>>) =>
        aud === "ADMIN" ? k
          : aud === "VENDOR" ? { orders: k.orders, customers: k.buyers, salesNet: k.net, payoutNet: k.payout, averageOrderNet: k.aov, cancelled: k.cancelled, credited: k.credited }
            : { orders: k.orders, spentNet: k.net, spentInclVat: k.gross, averageOrderNet: k.aov, cancelled: k.cancelled };
      const cur = shape(await kpis(f));
      const prev = i.compare_previous ? shape(await kpis(previousPeriod(f))) : null;
      return { period: { from: p.from.toISOString().slice(0, 10), toExclusive: p.to.toISOString().slice(0, 10) }, currency: "EUR", current: cur, previous: prev };
    },
  }),
  tool({
    name: "breakdown", sides: ["STAFF", "VENDOR", "BUYER"],
    description: "Top products / suppliers / customers / categories / countries, or a timeline by week or month, for a period. Amounts are net of VAT in EUR.",
    properties: { by: { type: "string", enum: ["product", "category", "vendor", "buyer", "country", "week", "month"], description: "vendor = supplier, buyer = customer. Buyers can't break down by customer; suppliers can't by supplier or country." }, period, limit },
    input: z.object({ by: z.enum(["product", "category", "vendor", "buyer", "country", "week", "month"]), period: z.enum(PERIODS), limit: lim }),
    run: async (ctx, side, i, locale) => {
      const aud = audienceOf(side);
      const scope = await analyticsScope(ctx, aud);
      const dim = i.by as Dim;
      const lineDim = dim === "product" || dim === "category";
      const metrics: Metric[] = aud === "ADMIN" ? (lineDim ? ["net", "units", "margin", "orders"] : ["net", "orders", "margin", "buyers"])
        : aud === "VENDOR" ? (lineDim ? ["payout", "units", "orders"] : ["payout", "orders"])
          : (lineDim ? ["net", "units", "orders"] : ["net", "orders"]);
      assertAllowed(aud, [dim], metrics);
      const p = periodFrom(i.period);
      const rows = await report({ from: p.from, to: p.to, basis: "placed", ...scope }, [dim], metrics, { limit: dim === "week" || dim === "month" ? undefined : i.limit });
      const labels = await labelsFor(dim, rows.map((r) => r.keys[dim]), (v) => pickLocalized(v, locale));
      return rows.map((r) => ({ [i.by]: labels.get(r.keys[dim] ?? "") ?? (r.keys[dim] ?? "—").slice(0, 10), ...r.values }));
    },
  }),
  tool({
    name: "demand_forecast", sides: ["STAFF", "VENDOR"],
    description: "Units per product for the next 4 weeks (trend-following forecast from the last 12 weeks of orders), with the trend vs the last 4 weeks. Supplier: its own products only.",
    properties: { product_query: { type: "string", description: "Part of a product name or SKU, or empty for all" }, limit },
    input: z.object({ product_query: z.string(), limit: lim }),
    run: async (ctx, side, i, locale) => {
      const q = i.product_query.trim().toLowerCase();
      const rows = await demandForecast(ctx, side, { locale, limit: 500 });
      return rows.filter((r) => !q || r.product.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q)).slice(0, i.limit)
        .map((r) => ({ product: `${r.product} (${r.pack})`, sku: r.sku, supplier: r.vendor, last4Weeks: r.lastWeeks, next4Weeks: r.nextWeeks, trend: r.trend, weeklyHistory: r.history, weeklyForecast: r.forecast }));
    },
  }),
  tool({
    name: "stock_outlook", sides: ["STAFF", "VENDOR"],
    description: "Stock left per product and how many days it lasts at the current selling rate (OUT, CRITICAL < 7 days, LOW < 14 days). Supplier: its own stock.",
    properties: { only_at_risk: { type: "boolean", description: "Only out-of-stock, critical and low products" }, limit },
    input: z.object({ only_at_risk: z.boolean(), limit: lim }),
    run: async (ctx, side, i, locale) => (await stockPredictions(ctx, side as "STAFF" | "VENDOR", { locale, onlyAtRisk: i.only_at_risk })).slice(0, i.limit)
      .map((r) => ({ product: `${r.product} (${r.pack})`, sku: r.sku, supplier: r.vendor, available: r.available, sellsPerDay: r.dailyUnits, daysLeft: r.days, status: r.status, runsOutOn: r.runsOutOn })),
  }),
  tool({
    name: "reorder_outlook", sides: ["STAFF", "VENDOR", "BUYER"],
    description: "When customers usually reorder from each supplier (median gap between orders), when the next order is expected, how late it is, and the usual basket. Buyer: its own suppliers. Supplier: its own customers.",
    properties: { only_due: { type: "boolean", description: "Only orders that are due or late now" }, limit },
    input: z.object({ only_due: z.boolean(), limit: lim }),
    run: async (ctx, side, i, locale) => (await reorderPredictions(ctx, side, { locale, onlyDue: i.only_due, dueWithinDays: 1 })).slice(0, i.limit)
      .map((r) => ({ customer: r.buyer, supplier: r.seller, ordersIn6Months: r.orders, usuallyEveryDays: r.gapDays, lastOrder: r.lastOrder, expected: r.expected, daysLate: Math.max(0, r.overdueDays), usualOrderNet: r.usualNet, usualBasket: r.basket.map((b) => `${b.qty} × ${b.product} (${b.pack})${b.available ? "" : " — no longer available"}`) })),
  }),
  tool({
    name: "supplier_alternatives", sides: ["STAFF"],
    description: "Products bought from one supplier that another supplier offers cheaper (with enough stock) or with clearly better service, with the weekly saving.",
    properties: { limit },
    input: z.object({ limit: lim }),
    run: async (ctx, _s, i, locale) => (await supplierRecommendations(ctx, { locale })).slice(0, i.limit),
  }),
  tool({
    name: "margin_opportunities", sides: ["STAFF"],
    description: "Offers whose FIRINGI margin (commission) is below the minimum or target margin rules, sized by what they sell (€ a year missed).",
    properties: { limit },
    input: z.object({ limit: lim }),
    run: async (ctx, _s, i) => (await marginOpportunities(ctx)).slice(0, i.limit),
  }),
  tool({
    name: "delivery_risk", sides: ["STAFF", "VENDOR"],
    description: "Open orders likely to be late or short, with the reasons (not confirmed, requested date close or passed, too little stock, late driver ETA, supplier history).",
    properties: { limit },
    input: z.object({ limit: lim }),
    run: async (ctx, side, i) => (await deliveryRisk(ctx, side as "STAFF" | "VENDOR", { limit: i.limit })),
  }),
  tool({
    name: "supplier_scorecards", sides: ["STAFF", "VENDOR"],
    description: "Supplier score 0–100 from confirmation speed, fill rate, declines, on-time delivery, returns and customer rating. Supplier: only its own scorecard.",
    properties: { type: { type: "string", enum: ["ALL", "DISTRIBUTOR", "WHOLESALER"] }, days: { type: "integer", description: "Look-back in days (7–365)" } },
    input: z.object({ type: z.enum(["ALL", "DISTRIBUTOR", "WHOLESALER"]), days: z.number().int().transform((n) => Math.max(7, Math.min(365, n))) }),
    run: async (ctx, side, i) => {
      const { supplierScorecards } = await import("@/server/services/performance");
      const now = new Date();
      return supplierScorecards(ctx, i.type, { from: new Date(now.getTime() - i.days * 86400_000), to: now }, side === "VENDOR" ? ctx.company.id : undefined);
    },
  }),
  tool({
    name: "find_orders", sides: ["STAFF", "VENDOR", "BUYER"],
    description: "Find orders by number, company or product text, optionally by state. Returns the most recent first.",
    properties: { query: { type: "string", description: "Order number (FO-…), company name, or empty" }, state: { type: "string", enum: ["ANY", "OPEN", "DELIVERED", "CANCELLED", "ON_HOLD"] }, limit },
    input: z.object({ query: z.string(), state: z.enum(["ANY", "OPEN", "DELIVERED", "CANCELLED", "ON_HOLD"]), limit: lim }),
    run: async (ctx, side, i) => {
      const { listOrders } = await import("@/server/services/orders");
      const statuses = i.state === "ANY" ? undefined : i.state === "OPEN" ? (["NEW", "PENDING_CONFIRMATION", "SUPPLIER_PROCESSING", "READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "EXCEPTION"] as const) : ([i.state] as const);
      const r = await listOrders(ctx, side === "STAFF" ? "ADMIN" : side, { q: i.query.trim() || undefined, statuses: statuses ? [...statuses] : undefined });
      // Payout and margin are only in non-buyer rows (listOrders omits them for buyers).
      const inner = (o: (typeof r.rows)[number]) => o as unknown as { vendorPayableNet: unknown; firingiMarginNet: unknown };
      return { total: r.total, orders: r.rows.slice(0, i.limit).map((o) => ({
        number: o.number, placed: o.placedAt.toISOString().slice(0, 16).replace("T", " "), status: o.status,
        customer: o.buyer.tradeName ?? o.buyer.legalName, supplier: o.seller.tradeName ?? o.seller.legalName,
        ...(side === "BUYER" ? { totalInclVat: Number(o.grandTotal), netTotal: Number(o.netTotal) }
          : side === "VENDOR" ? { netTotal: Number(o.netTotal), yourPayoutNet: Number(inner(o).vendorPayableNet) }
            : { netTotal: Number(o.netTotal), totalInclVat: Number(o.grandTotal), firingiMarginNet: Number(inner(o).firingiMarginNet) }),
      })) };
    },
  }),
  tool({
    name: "search_catalogue", sides: ["BUYER"],
    description: "Search the products this buyer can order (its own country's suppliers): offer id (for add_to_cart), price per pack excl. / incl. VAT, stock status, minimum order and multiples, current offers.",
    properties: { query: { type: "string", description: "Product name, brand, SKU or barcode" }, limit },
    input: z.object({ query: z.string(), limit: lim }),
    run: async (ctx, _s, i, locale) => {
      const { searchAcrossSuppliers } = await import("@/server/data/catalogue-buyer");
      const r = await searchAcrossSuppliers(ctx, i.query);
      return r.items.slice(0, i.limit).map((x) => ({
        offerId: x.offerId, product: pickLocalized(x.name, locale), pack: pickLocalized(x.packaging.name, locale), supplier: x.vendor.name, sku: x.sku,
        pricePerPackNet: x.price?.unitPriceNet ?? null, pricePerPackInclVat: x.price?.unitPriceGross ?? null, stock: x.stockStatus, minOrderQty: x.minOrderQty, qtyStep: x.qtyStep,
        offers: (x.price?.promotions ?? []).map((p) => p.name).filter(Boolean),
      }));
    },
  }),

  // ── support & sales agent (customers and suppliers) ──
  tool({
    name: "add_to_cart", sides: ["BUYER"],
    description: "Put a product in this customer's cart — ONLY when the customer clearly asked for that product and quantity (ask first if it is unclear which product or how many). Uses the offer id from search_catalogue. It never places an order: the customer checks the cart and places it.",
    properties: { offer_id: { type: "string", description: "offerId from search_catalogue" }, qty: { type: "integer", description: "Packs to add (respect the minimum and multiples)" } },
    input: z.object({ offer_id: z.string().min(1), qty: z.number().int().min(1).max(10000) }),
    run: async (ctx, _s, i, locale) => {
      const { can } = await import("@/server/rbac/guard");
      if (!can(ctx, "buyer.orders.place")) throw new (await import("@/server/errors")).ForbiddenError();
      const { addToCart } = await import("@/server/services/cart");
      const { catalogueItem } = await import("@/server/data/catalogue-buyer");
      const r = await addToCart(ctx, i.offer_id, i.qty);
      const { item } = await catalogueItem(ctx, i.offer_id);
      const card: ToolCard = { kind: "cart", product: pickLocalized(item.name, locale), pack: pickLocalized(item.packaging.name, locale), qty: i.qty, cartQty: r.qty };
      return { added: true, product: card.product, pack: card.pack, qtyAdded: i.qty, qtyInCartNow: r.qty, note: "Not ordered yet — the customer checks the cart and places the order.", card };
    },
  }),
  tool({
    name: "view_cart", sides: ["BUYER"],
    description: "What is in this customer's cart now: products, quantities, totals, delivery fee, and whether a minimum order is still missing.",
    properties: {},
    input: z.object({}),
    run: async (ctx, _s, _i, locale) => {
      const { cartView } = await import("@/server/services/cart");
      const v = (await cartView(ctx)) as unknown as { lines: { name?: unknown; packaging?: { name?: unknown }; qty: number; lineGross?: string }[]; totalGross?: string; groups?: { supplier: { name: string }; delivery: { ok: boolean; reason?: string; missing?: string; unit?: string; feeNet?: string } }[] };
      return {
        lines: v.lines.map((l) => ({ product: pickLocalized((l.name ?? {}) as Record<string, string>, locale), pack: pickLocalized((l.packaging?.name ?? {}) as Record<string, string>, locale), qty: l.qty, lineInclVat: l.lineGross ?? null })),
        totalInclVat: v.totalGross ?? null,
        delivery: (v.groups ?? []).map((g) => ({ supplier: g.supplier.name, ok: g.delivery.ok, ...(g.delivery.ok ? { feeNet: g.delivery.feeNet } : { problem: g.delivery.reason, missing: g.delivery.missing, unit: g.delivery.unit }) })),
        where: "Cart: /buy/orders/cart",
      };
    },
  }),
  tool({
    name: "my_invoices", sides: ["BUYER"],
    description: "This customer's unpaid invoices: number, date, due date, amount still open, overdue or not. Paying: Invoices & Payments.",
    properties: { limit },
    input: z.object({ limit: lim }),
    run: async (ctx, _s, i) => {
      const { listSalesInvoices } = await import("@/server/services/finance");
      const rows = await listSalesInvoices(ctx, { as: "BUYER", unpaidOnly: true });
      return { openInvoices: rows.slice(0, i.limit).map((r) => ({ number: r.fullNumber, issued: r.issuedAt?.toISOString().slice(0, 10) ?? null, due: r.dueAt?.toISOString().slice(0, 10) ?? null, openAmount: r.open, overdue: r.overdue, order: r.order?.number ?? null })), totalOpen: rows.reduce((a, r) => a + Number(r.open), 0).toFixed(2), where: "Invoices & Payments: /buy/finance/invoices" };
    },
  }),
  tool({
    name: "my_claims", sides: ["BUYER", "VENDOR"],
    description: "Quality claims (damaged, missing, wrong, warm, short-dated or poor-quality goods): number, order, problem, status, credit. Customers report a new one from the delivered order (Report a problem), within the claim window.",
    properties: { limit },
    input: z.object({ limit: lim }),
    run: async (ctx, side, i) => {
      const { listClaims, claimSettings } = await import("@/server/claims/service");
      const rows = await listClaims(ctx, side === "VENDOR" ? "VENDOR" : "BUYER");
      const s = await claimSettings();
      return { claimWindowHours: s.windowHours, claims: rows.slice(0, i.limit).map((r) => ({ number: r.number, order: r.orderNumber, problem: r.reason, status: r.status, opened: r.createdAt.toISOString().slice(0, 10), ...(side === "BUYER" ? { credit: r.credit } : { yourAnswer: r.supplierResponse }) })),
        where: side === "VENDOR" ? "Orders › Quality Claims: /vendor/orders/claims" : "Orders › Quality Claims: /buy/orders/claims; report a problem from the delivered order: /buy/orders/<order id>/claim" };
    },
  }),
  tool({
    name: "my_statements", sides: ["VENDOR"],
    description: "This supplier's billing statements still open (what to invoice FIRINGI, incl. credit statements from returns / quality claims) and its open claim charge-backs. Payouts follow approved invoices.",
    properties: { limit },
    input: z.object({ limit: lim }),
    run: async (ctx, _s, i) => {
      const { listStatements } = await import("@/server/services/finance");
      const { listChargebacks } = await import("@/server/claims/service");
      const st = await listStatements(ctx, "VENDOR", { openOnly: true });
      const cbs = await listChargebacks(ctx, "VENDOR", {}).catch(() => []);
      return {
        openStatements: st.slice(0, i.limit).map((x) => ({ number: x.number, order: x.order.number, credit: x.isCreditStatement, gross: x.expectedGross.toString(), status: x.status })),
        openChargebacks: cbs.filter((c) => c.status === "OPEN" || c.status === "DISPUTED").map((c) => ({ claim: c.claimNumber, amount: c.amount, status: c.status })),
        where: "Finance › Billing Statements: /vendor/finance/statements",
      };
    },
  }),
  // ── WhatsApp ordering (Phase 58) ──
  tool({
    name: "propose_order", sides: ["BUYER"], channels: ["WHATSAPP"],
    description: "Send the customer their cart as an order to confirm on WhatsApp: it checks delivery for each supplier (each supplier's own minimum order and free-delivery amount, the fee) and the total incl. VAT. If something is missing it returns the problems instead (e.g. how much more to reach a supplier's minimum) — tell the customer. Use it when the customer wants to order or after you filled the cart with what they asked. The order is placed ONLY when the customer replies YES; never say it is placed.",
    properties: {},
    input: z.object({}),
    run: async (ctx, _s, _i, locale, extra) => {
      if (!extra.waNumber) throw new (await import("@/server/errors")).ValidationError("Only on WhatsApp.");
      const { proposeOrder } = await import("@/server/whatsapp/ordering");
      const r = await proposeOrder(ctx, extra.waNumber, locale, extra.conversationId ?? null);
      return r.ok
        ? { proposed: true, ...r.summary, next: "Show the customer this order briefly (lines, delivery per supplier, total incl. VAT) and tell them to reply YES to place it or NO to cancel, or to tell you what to change. Do not say it is placed.", card: { kind: "proposal", draftId: r.draftId } satisfies ToolCard }
        : { proposed: false, problems: r.problems, next: "Tell the customer what is missing and offer to add products." };
    },
  }),
  tool({
    name: "repeat_last_order", sides: ["BUYER"], channels: ["WHATSAPP"],
    description: "Put the products and quantities of the customer's last order back in the cart (the cart is emptied first). Use when they ask for 'the same as last time' / 'repeat'. Then call propose_order.",
    properties: {},
    input: z.object({}),
    run: async (ctx, _s, _i, locale) => {
      const { repeatLastOrder } = await import("@/server/whatsapp/ordering");
      return repeatLastOrder(ctx, locale);
    },
  }),
  tool({
    name: "pay_invoices_link", sides: ["BUYER"], channels: ["WHATSAPP"],
    description: "A secure payment link (MB WAY, Multibanco, card…) for all of this customer's open invoices. Use when they ask how to pay or what they owe and want to pay now.",
    properties: {},
    input: z.object({}),
    run: async (ctx) => {
      const { payLinkForOpenInvoices } = await import("@/server/whatsapp/ordering");
      return payLinkForOpenInvoices(ctx);
    },
  }),
  tool({
    name: "handover", sides: ["BUYER", "VENDOR"],
    description: "Offer to pass the conversation to FIRINGI's support team (a person). Use when you can't solve it, it needs a decision or a change only FIRINGI staff can make (refunds, cancellations, account or price changes, complaints), or the person asks for a human. Shows a 'Send to FIRINGI support' button; the person taps it to send a support request with your summary and this chat.",
    properties: {
      subject: { type: "string", description: "Short subject in the person's language" },
      summary: { type: "string", description: "2–5 sentences for FIRINGI staff: the problem, what was checked, what the person wants (order / invoice numbers)" },
      category: { type: "string", enum: ["ORDER", "DELIVERY", "INVOICE", "PAYMENT", "PRODUCT", "ACCOUNT", "OTHER"] },
    },
    input: z.object({ subject: z.string().min(3).max(150), summary: z.string().min(5).max(2000), category: z.enum(["ORDER", "DELIVERY", "INVOICE", "PAYMENT", "PRODUCT", "ACCOUNT", "OTHER"]) }),
    run: async (_ctx, _s, i) => {
      const card: ToolCard = { kind: "handover", subject: i.subject, summary: i.summary, category: i.category };
      return { offered: true, note: "A 'Send to FIRINGI support' button is now shown — tell the person to tap it; FIRINGI staff answer in Help & Support.", card };
    },
  }),
  tool({
    name: "open_suggestions", sides: ["STAFF", "VENDOR", "BUYER"],
    description: "The AI suggestions currently open for this user (reorders due, stock running out, better suppliers, margin gaps, late deliveries, rising demand), most important first.",
    properties: { limit },
    input: z.object({ limit: lim }),
    run: async (ctx, side, i) => (await listRecommendations(ctx, side, { limit: i.limit })).map((r) => ({ kind: r.kind, title: r.title, importance: r.score, since: r.createdAt.toISOString().slice(0, 10) })),
  }),
  tool({
    name: "my_services", sides: ["BUYER"],
    description: "The customer's services (used cooking oil collection, grease trap cleaning, pest control…): plans and how often, the next visits, the last ones with litres collected, and the fryers' oil status (days since change, polar %, used oil waiting, how full the containers are).",
    properties: {},
    input: z.object({}),
    run: async (ctx) => (await import("@/server/servicing/ai")).myServicesForAi(ctx),
  }),
  tool({
    name: "price_check", sides: ["BUYER"],
    description: "Is the customer paying too much? Compares what it paid per unit (last 90 days) with what similar businesses nearby pay for the same product (anonymous: median, typical range, the share paying less), the yearly saving at the median and cheaper offers for the same product on FIRINGI. Give a product name / SKU, or leave empty for the biggest savings.",
    properties: { product: { type: "string", description: "product name or SKU, or empty" } },
    input: z.object({ product: z.string().max(80) }),
    run: async (ctx, _s, i) => (await import("@/server/benchmark/service")).priceCheckForAi(ctx, i.product),
  }),
  tool({
    name: "my_food_safety", sides: ["BUYER"],
    description: "The customer's food safety (HACCP) logbook: today's and this week's completion, temperature checks and checklists still due today (and late ones), readings out of range with the corrective action taken, tips (fridges drifting towards their limit, checks often missed, training running out) and each fridge's readings today.",
    properties: {},
    input: z.object({}),
    run: async (ctx) => (await import("@/server/haccp/service")).foodSafetyForAi(ctx),
  }),
  tool({
    name: "request_collection", sides: ["BUYER"],
    description: "Request a collection / visit for one of the customer's services (e.g. 'collect my used oil'). Use only when the customer asks for it. Give the serviceTypeId from my_services, a date (YYYY-MM-DD, or empty for the first possible day) and a short note.",
    properties: { service_type_id: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD or empty" }, note: { type: "string" } },
    input: z.object({ service_type_id: z.string().min(5).max(40), date: z.string().max(10), note: z.string().max(300) }),
    run: async (ctx, _s, i) => {
      const { requestVisit } = await import("@/server/servicing/plans");
      const d = /^\d{4}-\d{2}-\d{2}$/.test(i.date) ? new Date(`${i.date}T00:00:00Z`) : null;
      const v = await requestVisit(ctx, { serviceTypeId: i.service_type_id, date: d, note: i.note || null, reason: "ASSISTANT" });
      return { requested: true, number: v.number, date: v.date.toISOString().slice(0, 10), status: v.status, note: "The provider confirms the day; the customer sees it in Services." };
    },
  }),
  tool({
    name: "services_overview", sides: ["STAFF"],
    description: "FIRINGI's services (used oil collection, cleaning, pest control…): requests waiting, visits in the next 7 days, missed visits, litres of used oil collected and fees / commission in 30 days, money still open (oil to pay customers, providers to pay, commission to invoice).",
    properties: {},
    input: z.object({}),
    run: async (ctx) => (await import("@/server/servicing/ai")).servicesOverviewForAi(ctx),
  }),
  tool({
    name: "profit_and_loss", sides: ["STAFF"],
    description: "FIRINGI's monthly profit and loss (revenue, gross profit, costs, net profit) for the last N months. Finance staff only.",
    properties: { months: { type: "integer", description: "1–24" } },
    input: z.object({ months: z.number().int().transform((n) => Math.max(1, Math.min(24, n))) }),
    run: async (ctx, _s, i) => {
      const { profitAndLoss } = await import("@/server/services/profit");
      return profitAndLoss(ctx, { months: i.months });
    },
  }),
];

export const toolsFor = (side: Side, channel: Channel = "WEB") => TOOLS.filter((t) => t.sides.includes(side) && (!t.channels || t.channels.includes(channel)));

/** Tool definitions for the Messages API (strict schemas). */
export function apiTools(side: Side, channel: Channel = "WEB") {
  return toolsFor(side, channel).map((t) => ({
    name: t.name, description: t.description, strict: true,
    input_schema: { type: "object" as const, properties: t.properties, required: Object.keys(t.properties), additionalProperties: false },
  }));
}

