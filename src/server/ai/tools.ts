/**
 * The AI Business Assistant's tools. All read-only, all run with the asking user's own context
 * (so the normal permission and visibility rules apply), and each is offered only on the sides
 * that may use it. Buyers never get commission, supplier payouts or other buyers' data: their
 * tools go through the buyer-facing services, which don't return those.
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
  run: (ctx: Ctx, side: Side, input: T, locale: string) => Promise<unknown>;
};
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
    description: "Search the products this buyer can order (its own country's suppliers), with price per pack and stock status.",
    properties: { query: { type: "string", description: "Product name, brand, SKU or barcode" }, limit },
    input: z.object({ query: z.string(), limit: lim }),
    run: async (ctx, _s, i, locale) => {
      const { searchAcrossSuppliers } = await import("@/server/data/catalogue-buyer");
      const r = await searchAcrossSuppliers(ctx, i.query);
      return r.items.slice(0, i.limit).map((x) => ({
        product: pickLocalized(x.name, locale), pack: pickLocalized(x.packaging.name, locale), supplier: x.vendor.name, sku: x.sku,
        pricePerPackNet: x.price?.unitPriceNet ?? null, pricePerPackInclVat: x.price?.unitPriceGross ?? null, stock: x.stockStatus, minOrderQty: x.minOrderQty,
      }));
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

export const toolsFor = (side: Side) => TOOLS.filter((t) => t.sides.includes(side));

/** Tool definitions for the Messages API (strict schemas). */
export function apiTools(side: Side) {
  return toolsFor(side).map((t) => ({
    name: t.name, description: t.description, strict: true,
    input_schema: { type: "object" as const, properties: t.properties, required: Object.keys(t.properties), additionalProperties: false },
  }));
}

