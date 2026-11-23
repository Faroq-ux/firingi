import "server-only";
/** Pre-orders & price locks for the Assistant (Phase 71). */
import type { Ctx } from "@/server/context";
import { preSettings } from "./settings";

/** Buyer: open pre-orders (suggested first), its own pre-orders, its price locks and products worth locking. */
export async function preordersForBuyerAi(ctx: Ctx) {
  const s = await preSettings();
  if (!s.parts.ai) return { available: false, reason: "FIRINGI has switched this off." };
  const out: Record<string, unknown> = { available: true, page: "/buy/orders/preorders" };
  try {
    const { buyerPreorders } = await import("./campaigns");
    const b = await buyerPreorders(ctx, ctx.user.locale ?? "en");
    out.openPreorders = b.campaigns.slice(0, 8).map((c) => ({ title: c.title, supplier: c.vendor, closes: c.closesAt.toISOString().slice(0, 10), deliveryDates: c.deliveryDates.map((d) => d.toISOString().slice(0, 10)), depositPct: c.depositPct, suggestedForYou: c.suggested, alreadyPreordered: !!c.mine, products: c.items.map((i) => ({ product: i.product, pack: i.pack, pricePerPackNow: i.price, nextTier: i.next ? { atTotalPacks: i.next.minTotal, price: i.next.unitNet, packsMissing: i.next.missing } : null })) }));
    out.myPreorders = b.reservations.slice(0, 10).map((r) => ({ number: r.number, title: r.title, status: r.status, delivery: r.deliveryDate.toISOString().slice(0, 10), depositDue: r.deposit.due ? r.deposit.amount : 0, lines: r.lines.map((l) => ({ product: l.product, asked: l.qty, given: l.allocatedQty, price: l.unitNet })) }));
  } catch { out.preorders = "not available for this company"; }
  try {
    const { myLocks } = await import("./locks");
    const m = await myLocks(ctx, ctx.user.locale ?? "en");
    out.priceLocks = m.locks.filter((l) => ["REQUESTED", "REVIEW", "ACTIVE"].includes(l.status)).map((l) => ({ number: l.number, product: l.product, status: l.status, price: l.unitNet, listPriceWhenLocked: l.listUnitNet, packsLeft: l.left, until: l.validUntil?.toISOString().slice(0, 10) ?? null, suggestedPerMonth: l.perMonth, saved: l.saved }));
    out.worthLocking = m.suggestions.map((x) => ({ product: x.product, supplier: x.vendor, priceToday: x.price, youBuyPerMonth: x.perMonth, idea: `lock ${x.perMonth * 3} packs for 3 months` }));
  } catch { out.priceLocks = "not available for this company"; }
  return out;
}

/** Supplier: its campaigns with demand, and price locks to answer / packs committed. */
export async function preordersForVendorAi(ctx: Ctx) {
  const s = await preSettings();
  if (!s.parts.ai) return { available: false, reason: "FIRINGI has switched this off." };
  const out: Record<string, unknown> = { available: true, page: "/vendor/orders/preorders" };
  try {
    const { vendorCampaigns, campaignDetail } = await import("./campaigns");
    const v = await vendorCampaigns(ctx);
    const live = v.campaigns.filter((c) => ["OPEN", "ALLOCATED", "PENDING"].includes(c.status)).slice(0, 5);
    out.campaigns = await Promise.all(live.map(async (c) => {
      const d = await campaignDetail(ctx, c.id, ctx.user.locale ?? "en");
      return { number: c.number, title: c.title, status: c.status, closes: c.closesAt.toISOString().slice(0, 10), buyers: c.buyers, value: d.value, products: d.items.map((i) => ({ product: i.product, preordered: i.total, supply: i.supplyQty, price: i.price, nextTier: i.next })), plan: d.plan.map((p) => ({ date: p.date.toISOString().slice(0, 10), packs: p.items.filter((x) => x.qty).map((x) => `${x.product}: ${x.qty}`) })) };
    }));
  } catch { out.campaigns = "not available for this company"; }
  try {
    const { vendorLocks } = await import("./locks");
    const l = await vendorLocks(ctx, ctx.user.locale ?? "en");
    out.lockRequests = l.locks.filter((x) => x.status === "REQUESTED").map((x) => ({ number: x.number, buyer: x.buyer, product: x.product, packs: x.qtyTotal, months: x.months, price: x.unitNet }));
    out.committedPacks = l.committed;
  } catch { out.priceLocks = "not available for this company"; }
  return out;
}
