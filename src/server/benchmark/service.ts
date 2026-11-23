import "server-only";
/**
 * Price benchmark — Phase 70.
 *
 *   • rebuild(): what each buyer paid per base unit for each product variant over FIRINGI's period (its
 *     quantity-weighted average; cancelled / returned orders and catch-weight lines left out), grouped by country,
 *     region (the delivery address's city) and kind of business; a group is kept only with FIRINGI's minimum number
 *     of buyers. Also each buyer's possible yearly saving (for the monthly message and FIRINGI's view).
 *   • mine(): the customer's products against the most specific group with enough buyers — position, the yearly
 *     saving at the median, cheaper offers for the same product on FIRINGI, the basket at the median.
 *   • trend(): the customer's main products month by month against the market's median.
 *   • supplierPosition(): a supplier's list prices against what buyers pay (no other supplier named).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError } from "@/server/errors";
import { GROUP_ORDER, band, groupLevel, position, riseGap, stats, yearlySaving, type Stats } from "@/lib/benchmark";
import { benchSettings, buyerOn, supplierOn, type BenchSettings } from "./settings";

const DAY = 86400_000;
const LAST_RUN = "benchmark.lastRun";
const n = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));
export const nameIn = (name: unknown, locale = "en") => {
  const o = (name ?? {}) as Record<string, string>;
  return o[locale] ?? o[locale.split("-")[0]] ?? (locale.startsWith("pt") ? o.pt ?? o["pt-PT"] : undefined) ?? o.en ?? Object.values(o)[0] ?? "—";
};

const prismaSql = Prisma.sql;
const join = (xs: string[]) => Prisma.join(xs);
const joinAnd = (xs: Prisma.Sql[]) => Prisma.join(xs, " AND ");

type Row = { buyer: string; variant: string; country: string; spend: number; units: number; lines: number };
/** Per buyer and variant: spend and base units over the period (one query). */
async function purchases(since: Date, f: { buyer?: string; variants?: string[]; country?: string; excluded?: string[]; until?: Date } = {}) {
  const conds: Prisma.Sql[] = [
    prismaSql`o."placedAt" >= ${since}`, prismaSql`o.status NOT IN ('CANCELLED', 'RETURNED')`, prismaSql`vo."cwMode" IS NULL`,
  ];
  if (f.until) conds.push(prismaSql`o."placedAt" < ${f.until}`);
  if (f.buyer) conds.push(prismaSql`o."buyerCompanyId" = ${f.buyer}`);
  if (f.country) conds.push(prismaSql`o."countryId" = ${f.country}`);
  if (f.variants?.length) conds.push(prismaSql`pu."variantId" IN (${join(f.variants)})`);
  if (f.excluded?.length) conds.push(prismaSql`p."categoryId" NOT IN (${join(f.excluded)})`);
  return prisma.$queryRaw<Row[]>`
    SELECT o."buyerCompanyId" AS buyer, pu."variantId" AS variant, o."countryId" AS country,
      SUM(ol."unitSalePriceNet" * COALESCE(ol."qtyDelivered", ol."qtyConfirmed", ol."qtyOrdered"))::float8 AS spend,
      SUM(COALESCE(ol."qtyDelivered", ol."qtyConfirmed", ol."qtyOrdered") * GREATEST(pu."unitsPerPack", 1))::float8 AS units,
      COUNT(*)::int AS lines
    FROM "OrderLine" ol
    JOIN "Order" o ON o.id = ol."orderId"
    JOIN "VendorOffer" vo ON vo.id = ol."offerId"
    JOIN "PackagingUnit" pu ON pu.id = vo."packagingUnitId"
    JOIN "ProductVariant" v ON v.id = pu."variantId"
    JOIN "Product" p ON p.id = v."productId"
    WHERE ${joinAnd(conds)}
    GROUP BY 1, 2, 3
    HAVING SUM(COALESCE(ol."qtyDelivered", ol."qtyConfirmed", ol."qtyOrdered")) > 0`;
}

/** Each buyer's region (its first delivery address's city) and kind of business. */
async function buyerProfiles(ids: string[]) {
  const [cos, addrs] = await Promise.all([
    prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, businessType: true, type: true } }),
    prisma.address.findMany({ where: { companyId: { in: ids }, kind: "DELIVERY", isActive: true, cityId: { not: null } }, select: { companyId: true, isDefault: true, createdAt: true, city: { select: { regionId: true } } }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
  ]);
  const region = new Map<string, string>();
  for (const a of addrs) if (!region.has(a.companyId) && a.city) region.set(a.companyId, a.city.regionId);
  return new Map(cos.map((c) => [c.id, { regionId: region.get(c.id) ?? null, businessType: c.businessType ?? null, type: c.type }]));
}

// ── rebuild ─────────────────────────────────────────────────────────────────

export type LastRun = { at: string; groups: number; variants: number; buyers: number; totalSaving: number; topSavers: { companyId: string; saving: number; products: number }[]; notifiedMonth?: string };
export async function lastRun(): Promise<LastRun | null> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: LAST_RUN } });
  return (row?.value as LastRun | null) ?? null;
}
async function saveLastRun(v: LastRun) {
  await prisma.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: LAST_RUN } }, update: { value: v as unknown as Prisma.InputJsonValue }, create: { scope: "GLOBAL", key: LAST_RUN, value: v as unknown as Prisma.InputJsonValue } });
}

export async function rebuild(now = new Date(), s?: BenchSettings) {
  s ??= await benchSettings();
  const rows = await purchases(new Date(now.getTime() - s.periodDays * DAY), { excluded: s.excludedCategoryIds });
  const prof = await buyerProfiles([...new Set(rows.map((r) => r.buyer))]);
  // (variant, country, regionKey, typeKey) → buyer averages
  const groups = new Map<string, { variant: string; country: string; regionKey: string; typeKey: string; prices: number[]; lines: number }>();
  for (const r of rows) {
    const p = prof.get(r.buyer);
    if (!p || !(p.type === "CUSTOMER" || p.type === "WHOLESALER")) continue;
    const unit = r.spend / r.units;
    for (const g of GROUP_ORDER(p.regionId, p.businessType)) {
      const k = `${r.variant}|${r.country}|${g.regionKey}|${g.typeKey}`;
      const x = groups.get(k) ?? { variant: r.variant, country: r.country, regionKey: g.regionKey, typeKey: g.typeKey, prices: [], lines: 0 };
      x.prices.push(unit); x.lines += r.lines;
      groups.set(k, x);
    }
  }
  const keep: Prisma.PriceBenchmarkCreateManyInput[] = [];
  for (const g of groups.values()) {
    if (g.prices.length < s.minBuyers) continue;
    const st = stats(g.prices)!;
    keep.push({ variantId: g.variant, countryId: g.country, regionKey: g.regionKey, typeKey: g.typeKey, buyers: st.buyers, lines: g.lines, p10: st.p10, p25: st.p25, p50: st.p50, p75: st.p75, p90: st.p90, avg: st.avg, periodDays: s.periodDays, computedAt: now });
  }
  await prisma.$transaction(async (tx) => {
    await tx.priceBenchmark.deleteMany({});
    for (let i = 0; i < keep.length; i += 1000) await tx.priceBenchmark.createMany({ data: keep.slice(i, i + 1000) });
  }, { timeout: 120_000 });
  // each buyer's possible saving at the median of its best group
  const bench = new Map(keep.map((b) => [`${b.variantId}|${b.countryId}|${b.regionKey}|${b.typeKey}`, b]));
  const saving = new Map<string, { saving: number; products: number }>();
  for (const r of rows) {
    const p = prof.get(r.buyer);
    if (!p) continue;
    const g = GROUP_ORDER(p.regionId, p.businessType).map((x) => bench.get(`${r.variant}|${r.country}|${x.regionKey}|${x.typeKey}`)).find(Boolean);
    if (!g) continue;
    const sv = yearlySaving(r.spend / r.units, Number(g.p50), r.units, s.periodDays);
    if (sv <= 0) continue;
    const cur = saving.get(r.buyer) ?? { saving: 0, products: 0 };
    saving.set(r.buyer, { saving: Math.round((cur.saving + sv) * 100) / 100, products: cur.products + 1 });
  }
  const prev = await lastRun();
  const out: LastRun = {
    at: now.toISOString(), groups: keep.length, variants: new Set(keep.map((b) => b.variantId)).size, buyers: prof.size,
    totalSaving: Math.round([...saving.values()].reduce((a, x) => a + x.saving, 0)), topSavers: [...saving].map(([companyId, x]) => ({ companyId, ...x })).sort((a, b) => b.saving - a.saving).slice(0, 200),
    notifiedMonth: prev?.notifiedMonth,
  };
  await saveLastRun(out);
  return out;
}

// ── the customer ────────────────────────────────────────────────────────────

async function buyerAccess(ctx: Ctx) {
  if (!(ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER")) throw new ForbiddenError();
  if (!can(ctx, ["buyer.reports.view", "buyer.orders.view", "buyer.orders.place"])) throw new ForbiddenError();
  const s = await benchSettings();
  const co = await prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { businessType: true } });
  if (!buyerOn(s, { ...ctx.company, countryCode: ctx.company.countryCode, businessType: co.businessType })) throw new AppError("FEATURE_OFF", "FIRINGI hasn't switched the price benchmark on for your company.", 403);
  const prof = (await buyerProfiles([ctx.company.id])).get(ctx.company.id);
  return { s, regionId: prof?.regionId ?? null, businessType: co.businessType ?? null };
}
export async function benchAccess(c: { id: string; type: string; countryCode: string }) {
  const s = await benchSettings();
  const bt = (await prisma.company.findUnique({ where: { id: c.id }, select: { businessType: true } }))?.businessType ?? null;
  return { buyer: buyerOn(s, { ...c, businessType: bt }), supplier: supplierOn(s, c), s };
}

export type Alt = { offerId: string; vendor: string; pack: string; unitsPerPack: number; price: number; unitPrice: number; saving: number };
export async function mine(ctx: Ctx, locale = "en", now = new Date()) {
  const { s, regionId, businessType } = await buyerAccess(ctx);
  const rows = await purchases(new Date(now.getTime() - s.periodDays * DAY), { buyer: ctx.company.id, excluded: s.excludedCategoryIds });
  const variants = [...new Set(rows.map((r) => r.variant))];
  const [bench, vs] = await Promise.all([
    prisma.priceBenchmark.findMany({ where: { variantId: { in: variants }, countryId: ctx.company.countryId } }),
    prisma.productVariant.findMany({ where: { id: { in: variants } }, select: { id: true, sku: true, product: { select: { name: true } } } }),
  ]);
  const order = GROUP_ORDER(regionId, businessType);
  const items = rows.filter((r) => r.country === ctx.company.countryId).map((r) => {
    const g = order.map((k) => bench.find((b) => b.variantId === r.variant && b.regionKey === k.regionKey && b.typeKey === k.typeKey)).find(Boolean) ?? null;
    const unit = Math.round((r.spend / r.units) * 10000) / 10000;
    const v = vs.find((x) => x.id === r.variant);
    const st: Stats | null = g ? { buyers: g.buyers, p10: n(g.p10), p25: n(g.p25), p50: n(g.p50), p75: n(g.p75), p90: n(g.p90), avg: n(g.avg) } : null;
    return {
      variantId: r.variant, product: nameIn(v?.product.name, locale), sku: v?.sku ?? "", unitPrice: unit, units: Math.round(r.units), spend: Math.round(r.spend * 100) / 100,
      stats: st, level: g ? groupLevel({ regionKey: g.regionKey, typeKey: g.typeKey }) : null,
      position: st ? position(unit, st) : null, band: st ? band(unit, st.p50) : null,
      saving: st && s.parts.savings ? yearlySaving(unit, st.p50, r.units, s.periodDays) : 0,
      alternatives: [] as Alt[],
    };
  });
  // cheaper offers on FIRINGI for the same product (in the customer's country)
  const over = items.filter((i) => i.band === "ABOVE");
  if (s.parts.alternatives && over.length) {
    const { marketOffers } = await import("@/server/price-intel/service");
    const offers = (await marketOffers({ packaging: { variantId: { in: over.map((i) => i.variantId) } }, countryId: ctx.company.countryId })).filter((o) => o.vendorId !== ctx.company.id);
    for (const i of over) {
      i.alternatives = offers.filter((o) => o.variantId === i.variantId && o.unitPrice < i.unitPrice * 0.98).sort((a, b) => a.unitPrice - b.unitPrice).slice(0, 3)
        .map((o) => ({ offerId: o.offerId, vendor: o.vendor, pack: nameIn(o.packaging, locale), unitsPerPack: o.unitsPerPack, price: o.price, unitPrice: Math.round(o.unitPrice * 10000) / 10000, saving: yearlySaving(i.unitPrice, o.unitPrice, i.units, s.periodDays) }));
    }
  }
  const compared = items.filter((i) => i.stats);
  const basket = s.parts.basket ? {
    spend: Math.round(compared.reduce((a, i) => a + i.spend, 0) * 100) / 100,
    atMedian: Math.round(compared.reduce((a, i) => a + i.stats!.p50 * i.units, 0) * 100) / 100,
  } : null;
  return {
    parts: s.parts, periodDays: s.periodDays, minBuyers: s.minBuyers, computedAt: (await lastRun())?.at ?? null,
    items: items.sort((a, b) => b.saving - a.saving || b.spend - a.spend),
    totals: { products: items.length, compared: compared.length, above: compared.filter((i) => i.band === "ABOVE").length, below: compared.filter((i) => i.band === "BELOW").length, savingYear: Math.round(compared.reduce((a, i) => a + i.saving, 0) * 100) / 100 },
    basket: basket ? { ...basket, saving: Math.max(0, Math.round((basket.spend - basket.atMedian) * 100) / 100) } : null,
  };
}

/** The customer's main products month by month against the market's median (country, enough buyers). */
export async function trend(ctx: Ctx, locale = "en", now = new Date(), months = 6) {
  const { s } = await buyerAccess(ctx);
  if (!s.parts.trend) return { products: [], months: [] as string[] };
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const top = (await purchases(start, { buyer: ctx.company.id, country: ctx.company.countryId, excluded: s.excludedCategoryIds })).sort((a, b) => b.spend - a.spend).slice(0, 6);
  if (!top.length) return { products: [], months: [] };
  const keys: string[] = [];
  const out = top.map((t) => ({ variantId: t.variant, product: "", mine: [] as (number | null)[], market: [] as (number | null)[], gap: 0 }));
  for (let m = 0; m < months; m++) {
    const a = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1)), b = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1));
    keys.push(a.toISOString().slice(0, 7));
    const rows = await purchases(a, { until: b, country: ctx.company.countryId, variants: top.map((t) => t.variant), excluded: s.excludedCategoryIds });
    for (const p of out) {
      const mineRow = rows.find((r) => r.variant === p.variantId && r.buyer === ctx.company.id);
      p.mine.push(mineRow ? Math.round((mineRow.spend / mineRow.units) * 10000) / 10000 : null);
      const st = stats(rows.filter((r) => r.variant === p.variantId).map((r) => r.spend / r.units));
      p.market.push(st && st.buyers >= s.minBuyers ? st.p50 : null);
    }
  }
  const vs = await prisma.productVariant.findMany({ where: { id: { in: out.map((p) => p.variantId) } }, select: { id: true, product: { select: { name: true } } } });
  for (const p of out) {
    p.product = nameIn(vs.find((v) => v.id === p.variantId)?.product.name, locale);
    const idx = p.mine.map((x, i) => (x != null && p.market[i] != null ? i : -1)).filter((i) => i >= 0);
    if (idx.length >= 2) p.gap = riseGap(p.mine[idx[0]]!, p.mine[idx[idx.length - 1]]!, p.market[idx[0]]!, p.market[idx[idx.length - 1]]!);
  }
  return { products: out, months: keys, risePp: s.risePp };
}

// ── the supplier ────────────────────────────────────────────────────────────

export async function supplierPosition(ctx: Ctx, locale = "en") {
  if (!(ctx.company.type === "DISTRIBUTOR" || ctx.company.type === "WHOLESALER") || !can(ctx, ["vendor.reports.view", "vendor.products.manage"])) throw new ForbiddenError();
  const s = await benchSettings();
  if (!supplierOn(s, ctx.company)) throw new AppError("FEATURE_OFF", "FIRINGI hasn't switched the price position on for your company.", 403);
  const { marketOffers } = await import("@/server/price-intel/service");
  const offers = await marketOffers({ vendorCompanyId: ctx.company.id });
  const bench = await prisma.priceBenchmark.findMany({ where: { variantId: { in: [...new Set(offers.map((o) => o.variantId))] }, regionKey: "", typeKey: "" } });
  return offers.map((o) => {
    const g = bench.find((b) => b.variantId === o.variantId && b.countryId === o.countryId) ?? null;
    const st = g ? { p10: n(g.p10), p25: n(g.p25), p50: n(g.p50), p75: n(g.p75), p90: n(g.p90) } : null;
    return { offerId: o.offerId, product: nameIn(o.product, locale), pack: nameIn(o.packaging, locale), sku: o.sku, unitPrice: Math.round(o.unitPrice * 10000) / 10000, buyers: g?.buyers ?? 0, stats: st, position: st ? position(o.unitPrice, st) : null, band: st ? band(o.unitPrice, st.p50) : null };
  }).sort((a, b) => (b.position ?? -1) - (a.position ?? -1));
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export async function adminOverview(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.pricing.view", "admin.pricing.manage"])) throw new ForbiddenError();
  const run = await lastRun();
  const cos = run ? await prisma.company.findMany({ where: { id: { in: run.topSavers.slice(0, 20).map((x) => x.companyId) } }, select: { id: true, legalName: true, tradeName: true, type: true } }) : [];
  const byLevel = await prisma.priceBenchmark.groupBy({ by: ["regionKey", "typeKey"], _count: { _all: true } });
  const levels = { COUNTRY: 0, REGION: 0, TYPE: 0, REGION_TYPE: 0 };
  for (const g of byLevel) levels[groupLevel({ regionKey: g.regionKey === "" ? "" : "x", typeKey: g.typeKey === "" ? "" : "x" })] += g._count._all;
  return { run, levels, top: (run?.topSavers ?? []).slice(0, 20).map((x) => ({ ...x, name: cos.find((c) => c.id === x.companyId)?.tradeName ?? cos.find((c) => c.id === x.companyId)?.legalName ?? "—", type: cos.find((c) => c.id === x.companyId)?.type ?? "" })) };
}

/** FIRINGI: the businesses switched on or off one by one. */
export async function benchOverrideList(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.pricing.view", "admin.pricing.manage"])) throw new ForbiddenError();
  const s = await benchSettings();
  const ids = Object.keys(s.companies);
  const cos = ids.length ? await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true, tradeName: true, type: true } }) : [];
  return cos.map((c) => ({ id: c.id, name: c.tradeName ?? c.legalName, type: c.type, state: s.companies[c.id] as "ON" | "OFF" })).sort((a, b) => a.name.localeCompare(b.name));
}

// ── AI ──────────────────────────────────────────────────────────────────────

/** For the customer's Assistant: its prices against similar businesses (one product by name, or the biggest savings). */
export async function priceCheckForAi(ctx: Ctx, query: string, now = new Date()) {
  const m = await mine(ctx, "en", now);
  const q = query.trim().toLowerCase();
  const rows = (q ? m.items.filter((i) => i.product.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)) : m.items.filter((i) => i.saving > 0)).slice(0, 6);
  return {
    period: `last ${m.periodDays} days`, possibleSavingPerYear: m.totals.savingYear, productsCompared: m.totals.compared, productsAboveMarket: m.totals.above,
    products: rows.map((i) => ({
      product: i.product, myPricePerUnit: i.unitPrice, similarBuyersMedian: i.stats?.p50 ?? null, typicalRange: i.stats ? [i.stats.p25, i.stats.p75] : null,
      share_of_similar_buyers_paying_less_pct: i.position, savingPerYearAtMedian: i.saving, cheaperOffers: i.alternatives.map((a) => ({ supplier: a.vendor, pack: a.pack, pricePerUnit: a.unitPrice, savingPerYear: a.saving })),
    })),
    note: "Benchmark groups are anonymous (no buyer or supplier named) and need a minimum number of buyers.",
  };
}

/** FIRINGI's AI Centre: customers paying well above similar businesses (risk of buying elsewhere). */
export async function overpayingRecommendations(now = new Date()) {
  const s = await benchSettings();
  if (!s.enabled || !s.parts.ai) return [];
  const run = await lastRun();
  if (!run) return [];
  const big = run.topSavers.filter((x) => x.saving >= 200).slice(0, 30);
  const cos = await prisma.company.findMany({ where: { id: { in: big.map((x) => x.companyId) } }, select: { id: true, legalName: true, tradeName: true } });
  const mo = now.toISOString().slice(0, 7);
  return big.map((x) => {
    const name = cos.find((c) => c.id === x.companyId)?.tradeName ?? cos.find((c) => c.id === x.companyId)?.legalName ?? "—";
    return {
      kind: "CUSTOMER_OVERPAYING" as const, audience: "STAFF" as const, companyId: null, subjectType: "Company", subjectId: x.companyId, dedupeKey: `OVERPAY:${x.companyId}:${mo}`,
      title: `${name} pays about €${Math.round(x.saving).toLocaleString("en")} a year more than similar businesses on ${x.products} product${x.products === 1 ? "" : "s"} — at risk of buying elsewhere`,
      detail: { buyerId: x.companyId, buyer: name, savingYear: x.saving, products: x.products }, score: Math.max(0, Math.min(100, Math.round(40 + Math.log10(x.saving) * 12))),
    };
  });
}
