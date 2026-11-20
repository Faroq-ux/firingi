/**
 * Sustainability & CO₂ (Phase 51). Footprints (kg CO₂e) of products, packaging and delivery; "local" suppliers;
 * badges and a filter in the shop; the footprint of every order (estimated at checkout, final at delivery with the
 * real quantities and the delivering vehicle's fuel); green reports for buyers, suppliers and FIRINGI with a
 * CSRD-style export; lower-CO₂ alternatives; buyers' yearly goals; suppliers' green grade.
 * FIRINGI keeps a value per category; suppliers may enter exact values per offer (FIRINGI checks them, or AUTO).
 * Every part is FIRINGI's switch (Admin › Catalogue › Sustainability), per type and per business.
 */
import { pickLocalized } from "@/i18n/config";
import "server-only";
import { cache } from "react";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import {
  badges, cleanCo2Settings, DEFAULT_CATEGORY_FACTORS, deliveryFootprint, FUELS, goalProgress, haversineKm, mergeCo2Settings, packFootprint, packKg, PACKAGINGS, supplierGrade,
  type Co2Settings, type Fuel, type Packaging,
} from "@/lib/co2";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const KEY = "co2.settings";
const FEATURE = "CO2";
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const nameOf = (c: { tradeName: string | null; legalName: string }) => c.tradeName ?? c.legalName;
/** A localised name in the viewer's language (English when none is given). */
const pick = (n: unknown, locale = "en") => pickLocalized(n, locale);
const num = (v: unknown) => (v == null ? null : Number(v));

// ── settings & switches ─────────────────────────────────────────────────────

let cached: { at: number; s: Co2Settings; f: Map<string, { kgPerKg: number; own: boolean }> } | null = null;
export async function co2Settings(): Promise<Co2Settings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeCo2Settings(row?.value as Partial<Co2Settings> | null);
}

function staff(ctx: Ctx, manage = false) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  if (!can(ctx, manage ? ["admin.catalogue.manage", "admin.settings.manage"] : ["admin.catalogue.view", "admin.catalogue.manage", "admin.catalogue.approve", "admin.settings.manage"])) throw new ForbiddenError();
}

export async function saveCo2Settings(ctx: Ctx, input: Co2Settings) {
  staff(ctx, true);
  let v: Co2Settings;
  try { v = cleanCo2Settings(input); } catch (e) { throw new ValidationError((e as Error).message); }
  const before = await co2Settings();
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v } });
  cached = null;
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "co2.settings_saved", entityType: "Setting", entityId: KEY, before, after: v });
  return v;
}

export async function companySwitch(companyId: string): Promise<"DEFAULT" | "ON" | "OFF"> {
  const f = await prisma.companyFeature.findUnique({ where: { companyId_key: { companyId, key: FEATURE } } });
  return !f ? "DEFAULT" : f.enabled ? "ON" : "OFF";
}

export async function setCompanySwitch(ctx: Ctx, companyId: string, state: "DEFAULT" | "ON" | "OFF") {
  staff(ctx, true);
  const co = await prisma.company.findUnique({ where: { id: companyId }, select: { type: true } });
  if (!co || co.type === "ADMIN") throw new NotFoundError("Business");
  if (state === "DEFAULT") await prisma.companyFeature.deleteMany({ where: { companyId, key: FEATURE } });
  else await prisma.companyFeature.upsert({ where: { companyId_key: { companyId, key: FEATURE } }, create: { companyId, key: FEATURE, enabled: state === "ON", updatedById: ctx.user.id }, update: { enabled: state === "ON", updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "co2.company_switch", entityType: "Company", entityId: companyId, after: { state } });
}

/** Does this business see CO₂ (buyers) / may it enter values (suppliers)? */
export async function co2Access(co: { id: string; type: string }, s?: Co2Settings) {
  const set = s ?? (await co2Settings());
  if (!set.enabled) return { buyer: false, supplier: false, why: "OFF" as const };
  const sw = await companySwitch(co.id);
  if (sw === "OFF") return { buyer: false, supplier: false, why: "COMPANY_OFF" as const };
  const on = sw === "ON";
  const buyer = (co.type === "CUSTOMER" || co.type === "WHOLESALER") && (on || set.buyers[co.type]);
  const supplier = (co.type === "WHOLESALER" || co.type === "DISTRIBUTOR") && (on || set.suppliers[co.type]);
  return { buyer, supplier, why: buyer || supplier ? null : ("TYPE_OFF" as const) };
}

// ── category factors ────────────────────────────────────────────────────────

/** kg CO₂e per kg for every category: FIRINGI's value, else its default by slug, else the parent's, else the fallback. */
export async function categoryFactors(s?: Co2Settings) {
  if (cached && Date.now() - cached.at < 30_000) return cached.f;
  const set = s ?? (await co2Settings());
  const [cats, rows] = await Promise.all([prisma.category.findMany({ select: { id: true, parentId: true, slug: true } }), prisma.co2CategoryFactor.findMany()]);
  const own = new Map(rows.map((r) => [r.categoryId, Number(r.kgPerKg)]));
  const byId = new Map(cats.map((c) => [c.id, c]));
  const out = new Map<string, { kgPerKg: number; own: boolean }>();
  const resolve = (id: string, depth = 0): { kgPerKg: number; own: boolean } => {
    if (out.has(id)) return out.get(id)!;
    const c = byId.get(id);
    let v: { kgPerKg: number; own: boolean };
    if (!c || depth > 10) v = { kgPerKg: set.fallbackKgPerKg, own: false };
    else if (own.has(id)) v = { kgPerKg: own.get(id)!, own: true };
    else if (DEFAULT_CATEGORY_FACTORS[c.slug] != null) v = { kgPerKg: DEFAULT_CATEGORY_FACTORS[c.slug], own: false };
    else if (c.parentId) v = { ...resolve(c.parentId, depth + 1), own: false };
    else v = { kgPerKg: set.fallbackKgPerKg, own: false };
    out.set(id, v);
    return v;
  };
  for (const c of cats) resolve(c.id);
  cached = { at: Date.now(), s: set, f: out };
  return out;
}

export async function categoryTable(ctx: Ctx) {
  staff(ctx);
  const [cats, f] = await Promise.all([prisma.category.findMany({ select: { id: true, name: true, slug: true, depth: true, path: true }, orderBy: { path: "asc" } }), categoryFactors()]);
  const rows = await prisma.co2CategoryFactor.findMany();
  return cats.map((c) => ({ id: c.id, name: pick(c.name), depth: c.depth, kgPerKg: f.get(c.id)?.kgPerKg ?? 0, own: f.get(c.id)?.own ?? false, source: rows.find((r) => r.categoryId === c.id)?.source ?? null }));
}

export async function saveCategoryFactor(ctx: Ctx, categoryId: string, kgPerKg: number | null, source?: string | null) {
  staff(ctx, true);
  if (kgPerKg == null) await prisma.co2CategoryFactor.deleteMany({ where: { categoryId } });
  else {
    if (!(kgPerKg >= 0 && kgPerKg <= 200)) throw new ValidationError("kg CO₂e per kg must be between 0 and 200.");
    await prisma.co2CategoryFactor.upsert({ where: { categoryId }, create: { categoryId, kgPerKg: kgPerKg.toFixed(3), source: source?.trim() || null, updatedById: ctx.user.id }, update: { kgPerKg: kgPerKg.toFixed(3), source: source?.trim() || null, updatedById: ctx.user.id } });
  }
  cached = null;
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "co2.category_factor", entityType: "Category", entityId: categoryId, after: { kgPerKg, source } });
}

// ── footprints of offers ────────────────────────────────────────────────────

export type OfferFootprint = {
  offerId: string; vendorId: string; categoryId: string; kgPerKg: number; categoryKgPerKg: number; own: boolean; packaging: Packaging | null; recyclable: boolean;
  netKg: number; unitsPerPack: number; perPack: { product: number; packaging: number; total: number }; ratio: number;
};

export async function offerFootprints(offerIds: string[], s?: Co2Settings): Promise<Map<string, OfferFootprint>> {
  const set = s ?? (await co2Settings());
  if (!offerIds.length) return new Map();
  const [rows, f] = await Promise.all([
    prisma.vendorOffer.findMany({ where: { id: { in: [...new Set(offerIds)] } }, select: { id: true, vendorCompanyId: true, co2: true, packaging: { select: { netWeightKg: true, unitsPerPack: true, variant: { select: { product: { select: { categoryId: true } } } } } } } }),
    categoryFactors(set),
  ]);
  return new Map(rows.map((o) => {
    const cat = f.get(o.packaging.variant.product.categoryId)?.kgPerKg ?? set.fallbackKgPerKg;
    const ok = o.co2?.status === "APPROVED";
    const kgPerKg = ok && o.co2!.kgPerKg != null ? Number(o.co2!.kgPerKg) : cat;
    const packaging = ok && o.co2!.packaging && (PACKAGINGS as readonly string[]).includes(o.co2!.packaging) ? (o.co2!.packaging as Packaging) : null;
    const netKg = packKg({ netWeightKg: num(o.packaging.netWeightKg), unitsPerPack: o.packaging.unitsPerPack }, set);
    const perPack = packFootprint({ kgPerKg, netKg, unitsPerPack: o.packaging.unitsPerPack, packaging }, set);
    return [o.id, { offerId: o.id, vendorId: o.vendorCompanyId, categoryId: o.packaging.variant.product.categoryId, kgPerKg, categoryKgPerKg: cat, own: ok && o.co2!.kgPerKg != null, packaging, recyclable: ok && !!o.co2!.recyclable, netKg, unitsPerPack: o.packaging.unitsPerPack, perPack, ratio: cat > 0 ? kgPerKg / cat : 1 }];
  }));
}

/** Per request (React cache — the same ctx object within one request): settings, access, suppliers' distances. */
const settingsOnce = cache(co2Settings);
const accessOnce = cache(async (ctx: Ctx) => co2Access(ctx.company, await settingsOnce()));
const suppliersOnce = cache(async (ctx: Ctx) => {
  const { visibleSuppliers } = await import("@/server/data/catalogue-buyer");
  return visibleSuppliers(ctx).catch(() => []);
});

/** Suppliers' distance (km, straight line) from the buyer's delivery address. */
async function supplierKm(ctx: Ctx, vendorIds: string[]) {
  const all = await suppliersOnce(ctx);
  return new Map(all.filter((x) => vendorIds.includes(x.id)).map((x) => [x.id, x.distanceKm as number | null]));
}

/** Shop badges and the footprint per pack, for the buyer viewing them (empty when switched off). */
export async function co2Badges(ctx: Ctx, offerIds: string[]) {
  const s = await settingsOnce();
  if (!s.show.badges || !(await accessOnce(ctx)).buyer) return new Map<string, { badges: string[]; kg: number }>();
  const fp = await offerFootprints(offerIds, s);
  const km = s.parts.local ? await supplierKm(ctx, [...new Set([...fp.values()].map((x) => x.vendorId))]) : new Map();
  return new Map([...fp.values()].map((x) => {
    const d = km.get(x.vendorId);
    return [x.offerId, { badges: badges({ ...x, local: d != null ? d <= s.localKm : null }, s), kg: x.perPack.total }];
  }));
}

/** The shop filter: offers that are low CO₂ / local / in eco packaging (a Prisma where). */
export async function ecoWhere(ctx: Ctx, eco: string | null | undefined) {
  if (!eco || !["LOW_CO2", "LOCAL", "ECO_PACKAGING"].includes(eco)) return {};
  const s = await co2Settings();
  if (!s.enabled || !s.show.badges) return {};
  if (eco === "LOCAL") {
    const { visibleSuppliers } = await import("@/server/data/catalogue-buyer");
    const ids = (await visibleSuppliers(ctx)).filter((x) => x.distanceKm != null && x.distanceKm <= s.localKm).map((x) => x.id);
    return { vendorCompanyId: { in: ids } };
  }
  const rows = await prisma.offerCo2.findMany({ where: { status: "APPROVED" }, select: { offerId: true } });
  const fp = await offerFootprints(rows.map((r) => r.offerId), s);
  const ids = [...fp.values()].filter((x) => badges({ ...x, local: null }, s).includes(eco as "LOW_CO2" | "ECO_PACKAGING")).map((x) => x.offerId);
  return { id: { in: ids } };
}

/** The product page: its footprint, badges, and lower-CO₂ alternatives in the same category the buyer can order. */
export async function offerCo2View(ctx: Ctx, offerId: string, locale = "en") {
  const s = await co2Settings();
  if (!(await co2Access(ctx.company, s)).buyer) return null;
  const me = (await offerFootprints([offerId], s)).get(offerId);
  if (!me) return null;
  const b = (await co2Badges(ctx, [offerId])).get(offerId);
  let alternatives: { offerId: string; name: string; vendor: string; pack: string; perKg: number; savingPct: number }[] = [];
  if (s.show.alternatives) {
    const { browseCatalogue } = await import("@/server/data/catalogue-buyer");
    const same = await browseCatalogue(ctx, { categoryId: me.categoryId }).catch(() => null);
    const others = (same?.items ?? []).filter((i) => i.offerId !== offerId);
    const fp = await offerFootprints(others.map((i) => i.offerId), s);
    alternatives = others.map((i) => ({ i, f: fp.get(i.offerId) })).filter((x) => x.f && x.f.kgPerKg < me.kgPerKg * 0.95)
      .sort((a, b) => a.f!.kgPerKg - b.f!.kgPerKg).slice(0, 3)
      .map(({ i, f }) => ({ offerId: i.offerId, name: pick(i.name, locale), vendor: i.vendor.name, pack: pick(i.packaging.name, locale), perKg: f!.kgPerKg, savingPct: Math.round((1 - f!.kgPerKg / me.kgPerKg) * 100) }));
  }
  return { perPack: me.perPack, perKg: me.kgPerKg, categoryPerKg: me.categoryKgPerKg, own: me.own, packaging: me.packaging, recyclable: me.recyclable, badges: b?.badges ?? [], alternatives, show: s.show };
}

/** The cart: footprint per line and in total (products + packaging; delivery is added when the order is placed). */
export async function cartFootprint(ctx: Ctx, lines: { offerId: string; qty: number }[]) {
  const s = await co2Settings();
  if (!s.show.orders || !(await co2Access(ctx.company, s)).buyer) return null;
  const fp = await offerFootprints(lines.map((l) => l.offerId), s);
  const per = new Map(lines.map((l) => [l.offerId, r3((fp.get(l.offerId)?.perPack.total ?? 0) * l.qty)]));
  return { lines: per, total: r3([...per.values()].reduce((a, b) => a + b, 0)) };
}

// ── orders ──────────────────────────────────────────────────────────────────

/**
 * Write an order's footprint: each line (product + packaging) and the delivery (road km × tonnes × the vehicle's
 * fuel). At checkout it's an estimate (ordered quantities, the default fuel); at delivery (`final`) the delivered
 * quantities and the delivering vehicle. Never blocks an order.
 */
export async function stampOrder(tx: Tx, orderId: string, final = false) {
  // a savepoint: if anything here fails, only the stamp is undone — never the order or invoice around it
  const sp = await tx.$executeRawUnsafe("SAVEPOINT co2_stamp").then(() => true, () => false);
  try {
    const s = await co2Settings();
    if (!s.enabled) { if (sp) await tx.$executeRawUnsafe("RELEASE SAVEPOINT co2_stamp"); return; }
    const o = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, sellerCompanyId: true, sourceAddressId: true, deliveryAddress: true, lines: { select: { id: true, offerId: true, qtyOrdered: true, qtyConfirmed: true, qtyDelivered: true } } } });
    if (!o) { if (sp) await tx.$executeRawUnsafe("RELEASE SAVEPOINT co2_stamp"); return; }
    const fp = await offerFootprints(o.lines.map((l) => l.offerId), s);
    let products = 0, packaging = 0, weight = 0;
    for (const l of o.lines) {
      const q = final ? (l.qtyDelivered ?? l.qtyConfirmed ?? l.qtyOrdered) : l.qtyOrdered;
      const f = fp.get(l.offerId);
      if (!f) continue;
      products += f.perPack.product * q; packaging += f.perPack.packaging * q; weight += f.netKg * q;
      await tx.orderLine.update({ where: { id: l.id }, data: { co2Kg: r3(f.perPack.total * q).toFixed(3) } });
    }
    const to = o.deliveryAddress as { latitude?: string | null; longitude?: string | null } | null;
    const from = o.sourceAddressId
      ? await tx.address.findUnique({ where: { id: o.sourceAddressId }, select: { latitude: true, longitude: true } })
      : await tx.address.findFirst({ where: { companyId: o.sellerCompanyId, kind: { in: ["WAREHOUSE", "PICKUP"] }, latitude: { not: null } }, select: { latitude: true, longitude: true } });
    let km: number | null = null;
    if (to?.latitude && to?.longitude && from?.latitude != null && from?.longitude != null) km = haversineKm({ lat: Number(from.latitude), lng: Number(from.longitude) }, { lat: Number(to.latitude), lng: Number(to.longitude) });
    let fuel: Fuel = s.defaultFuel;
    if (final) {
      const v = (await tx.delivery.findUnique({ where: { orderId }, select: { vehicle: { select: { fuel: true } } } }).catch(() => null))?.vehicle?.fuel;
      if (v && (FUELS as readonly string[]).includes(v)) fuel = v as Fuel;
    }
    const delivery = s.parts.delivery && km != null ? deliveryFootprint(km, weight, fuel, s) : 0;
    await tx.order.update({ where: { id: orderId }, data: { co2ProductsKg: r3(products).toFixed(3), co2PackagingKg: r3(packaging).toFixed(3), co2DeliveryKg: delivery.toFixed(3), distanceKm: km != null ? km.toFixed(1) : null, isLocal: km != null ? km <= s.localKm : null, co2At: new Date() } });
    if (sp) await tx.$executeRawUnsafe("RELEASE SAVEPOINT co2_stamp");
  } catch (e) {
    console.error("[co2] stampOrder", orderId, (e as Error).message);
    if (sp) await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT co2_stamp").catch(() => null);
  }
}

/** The order page: its footprint (buyers who see CO₂, the supplier, FIRINGI). */
export async function orderCo2(ctx: Ctx, orderId: string) {
  const s = await co2Settings();
  if (!s.enabled || !s.show.orders) return null;
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { buyerCompanyId: true, sellerCompanyId: true, status: true, co2ProductsKg: true, co2PackagingKg: true, co2DeliveryKg: true, distanceKm: true, isLocal: true, co2At: true } });
  if (!o || !o.co2At) return null;
  if (ctx.company.type !== "ADMIN" && ctx.company.id !== o.buyerCompanyId && ctx.company.id !== o.sellerCompanyId) return null;
  if (ctx.company.id === o.buyerCompanyId && !(await co2Access(ctx.company, s)).buyer) return null;
  const p = Number(o.co2ProductsKg ?? 0), k = Number(o.co2PackagingKg ?? 0), d = Number(o.co2DeliveryKg ?? 0);
  return { products: p, packaging: k, delivery: d, total: r3(p + k + d), distanceKm: num(o.distanceKm), local: o.isLocal, final: o.status === "DELIVERED" };
}

// ── supplier values ─────────────────────────────────────────────────────────

function supplierSide(ctx: Ctx) {
  if (ctx.company.type !== "WHOLESALER" && ctx.company.type !== "DISTRIBUTOR") throw new ForbiddenError();
  if (!can(ctx, ["vendor.products.manage", "vendor.pricing.manage"])) throw new ForbiddenError();
}

/** The supplier's offers with their footprint, its own values and their status. */
export async function supplierCo2(ctx: Ctx, locale = "en") {
  supplierSide(ctx);
  const s = await co2Settings();
  const access = await co2Access(ctx.company, s);
  const offers = await prisma.vendorOffer.findMany({ where: { vendorCompanyId: ctx.company.id, status: { in: ["ACTIVE", "PAUSED"] } }, select: { id: true, co2: true, packaging: { select: { name: true, variant: { select: { sku: true, product: { select: { name: true } } } } } } }, take: 2000 });
  const fp = await offerFootprints(offers.map((o) => o.id), s);
  const rows = offers.map((o) => {
    const f = fp.get(o.id)!;
    return {
      offerId: o.id, label: `${pick(o.packaging.variant.product.name, locale)} — ${pick(o.packaging.name, locale)}`, sku: o.packaging.variant.sku, categoryKgPerKg: f.categoryKgPerKg, kgPerKg: f.kgPerKg, perPack: f.perPack.total,
      mine: o.co2 ? { kgPerKg: num(o.co2.kgPerKg), packaging: o.co2.packaging, recyclable: o.co2.recyclable, source: o.co2.source, status: o.co2.status, reviewNote: o.co2.reviewNote } : null,
    };
  }).sort((a, b) => a.label.localeCompare(b.label));
  const g = supplierGrade([...fp.values()].map((f) => ({ ratio: f.ratio, eco: badges({ ...f, local: null }, s).includes("ECO_PACKAGING"), own: f.own })));
  return { settings: s, access, rows, grade: s.show.supplierScore ? g : null };
}

export async function saveOfferCo2(ctx: Ctx, offerId: string, i: { kgPerKg: number | null; packaging: string | null; recyclable: boolean; source: string | null }) {
  supplierSide(ctx);
  const s = await co2Settings();
  if (!(await co2Access(ctx.company, s)).supplier) throw new ForbiddenError("FIRINGI hasn't opened CO₂ values for your business.");
  const offer = await prisma.vendorOffer.findFirst({ where: { id: offerId, vendorCompanyId: ctx.company.id } });
  if (!offer) throw new NotFoundError("Product");
  if (i.kgPerKg != null && !(i.kgPerKg >= 0 && i.kgPerKg <= 200)) throw new ValidationError("kg CO₂e per kg must be between 0 and 200.");
  if (i.packaging && !(PACKAGINGS as readonly string[]).includes(i.packaging)) throw new ValidationError("Choose the packaging.");
  if (i.kgPerKg != null && !i.source?.trim()) throw new ValidationError("Say where the value comes from (a study, an EPD, a supplier sheet…).");
  const status = s.approval === "AUTO" ? "APPROVED" : "PENDING";
  const data = { kgPerKg: i.kgPerKg == null ? null : i.kgPerKg.toFixed(3), packaging: i.packaging || null, recyclable: !!i.recyclable, source: i.source?.trim().slice(0, 300) || null, status, reviewNote: null, submittedById: ctx.user.id, reviewedById: null, reviewedAt: status === "APPROVED" ? new Date() : null } as const;
  await prisma.offerCo2.upsert({ where: { offerId }, create: { offerId, ...data }, update: data });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "co2.offer_value", entityType: "VendorOffer", entityId: offerId, after: { ...i, status } });
  if (status === "PENDING") {
    const admins = await prisma.company.findMany({ where: { type: "ADMIN" }, select: { id: true } });
    for (const a of admins) await notify("co2.review", [{ companyId: a.id, link: "/admin/catalogue/co2" }], { company: nameOf(ctx.company) }).catch(() => null);
  }
  return { status };
}

export async function reviewOfferCo2(ctx: Ctx, offerId: string, approve: boolean, note: string | null) {
  staff(ctx, true);
  const v = await prisma.offerCo2.findUnique({ where: { offerId }, include: { offer: { select: { vendorCompanyId: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } } } });
  if (!v || v.status !== "PENDING") throw new ValidationError("Nothing to check.");
  if (!approve && !note?.trim()) throw new ValidationError("Say why (the supplier sees it).");
  await prisma.offerCo2.update({ where: { offerId }, data: { status: approve ? "APPROVED" : "REJECTED", reviewNote: note?.trim() || null, reviewedById: ctx.user.id, reviewedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: approve ? "co2.value_approved" : "co2.value_rejected", entityType: "VendorOffer", entityId: offerId, after: { note } });
  await notify("co2.decided", [{ companyId: v.offer.vendorCompanyId, link: "/vendor/products/co2" }], { product: pick(v.offer.packaging.variant.product.name), decision: approve ? "✓" : "✗", reason: note ?? "" }).catch(() => null);
}

export async function pendingValues(ctx: Ctx) {
  staff(ctx);
  const rows = await prisma.offerCo2.findMany({ where: { status: "PENDING" }, include: { offer: { select: { vendor: { select: { legalName: true, tradeName: true } }, packaging: { select: { name: true, variant: { select: { sku: true, product: { select: { name: true, categoryId: true } } } } } } } } }, orderBy: { updatedAt: "asc" }, take: 300 });
  const f = await categoryFactors();
  return rows.map((r) => ({ offerId: r.offerId, supplier: nameOf(r.offer.vendor), product: `${pick(r.offer.packaging.variant.product.name)} — ${pick(r.offer.packaging.name)}`, sku: r.offer.packaging.variant.sku, kgPerKg: num(r.kgPerKg), categoryKgPerKg: f.get(r.offer.packaging.variant.product.categoryId)?.kgPerKg ?? null, packaging: r.packaging, recyclable: r.recyclable, source: r.source, updatedAt: r.updatedAt }));
}

// ── reports ─────────────────────────────────────────────────────────────────

type Side = "BUYER" | "VENDOR" | "ADMIN";
const yearRange = (year: number) => ({ start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) });

/** Delivered orders by their final CO₂ stamp (written at delivery). */
async function deliveredOrders(side: Side, companyId: string | null, start: Date, end: Date) {
  return prisma.order.findMany({
    where: { status: "DELIVERED", co2At: { gte: start, lt: end }, ...(side === "BUYER" ? { buyerCompanyId: companyId! } : side === "VENDOR" ? { sellerCompanyId: companyId! } : {}) },
    select: {
      id: true, co2At: true, netTotal: true, isLocal: true, co2ProductsKg: true, co2PackagingKg: true, co2DeliveryKg: true,
      buyer: { select: { id: true, legalName: true, tradeName: true } }, seller: { select: { id: true, legalName: true, tradeName: true } },
      lines: { select: { co2Kg: true, productName: true, sku: true, offer: { select: { packaging: { select: { variant: { select: { product: { select: { categoryId: true } } } } } } } } } },
    },
  });
}

/** The green report for a year: months, categories, the other side (suppliers / customers), top products, local share, kg per €; the buyer's goal. */
export async function co2ReportFor(ctx: Ctx, side: Side, year: number, locale = "en") {
  const s = await co2Settings();
  if (side === "ADMIN") staff(ctx);
  else {
    const a = await co2Access(ctx.company, s);
    if (side === "BUYER" && !a.buyer) throw new ForbiddenError();
    if (side === "VENDOR" && (ctx.company.type === "CUSTOMER" || !can(ctx, ["vendor.orders.view", "vendor.reports.view", "vendor.products.manage"]))) throw new ForbiddenError();
  }
  if (!s.enabled || !s.show.reports) throw new ValidationError("FIRINGI has switched CO₂ reports off.");
  const { start, end } = yearRange(year);
  const orders = await deliveredOrders(side, side === "ADMIN" ? null : ctx.company.id, start, end);
  const cats = new Map((await prisma.category.findMany({ select: { id: true, name: true } })).map((c) => [c.id, pick(c.name, locale)]));
  const months = Array.from({ length: 12 }, (_, m) => ({ month: m + 1, products: 0, packaging: 0, delivery: 0 }));
  const byCat = new Map<string, number>(), byParty = new Map<string, { name: string; kg: number; net: number }>(), byProduct = new Map<string, { name: string; kg: number }>();
  let localOrders = 0, net = 0;
  for (const o of orders) {
    const m = months[o.co2At!.getUTCMonth()];
    const p = Number(o.co2ProductsKg ?? 0), k = Number(o.co2PackagingKg ?? 0), d = Number(o.co2DeliveryKg ?? 0);
    m.products += p; m.packaging += k; m.delivery += d; net += Number(o.netTotal);
    if (o.isLocal) localOrders++;
    const party = side === "BUYER" ? o.seller : o.buyer;
    const pp = byParty.get(party.id) ?? { name: nameOf(party), kg: 0, net: 0 }; pp.kg += p + k + d; pp.net += Number(o.netTotal); byParty.set(party.id, pp);
    for (const l of o.lines) {
      const kg = Number(l.co2Kg ?? 0), cat = cats.get(l.offer.packaging.variant.product.categoryId) ?? "?";
      byCat.set(cat, (byCat.get(cat) ?? 0) + kg);
      const pr = byProduct.get(l.sku) ?? { name: pick(l.productName, locale), kg: 0 }; pr.kg += kg; byProduct.set(l.sku, pr);
    }
  }
  const total = r3(months.reduce((a, m) => a + m.products + m.packaging + m.delivery, 0));
  let goal: null | { reductionPct: number; thisYear: number; lastYear: number; target: number; change: number | null; onTrack: boolean | null } = null;
  if (side === "BUYER" && s.show.goals) {
    const g = await prisma.co2Goal.findUnique({ where: { companyId_year: { companyId: ctx.company.id, year } } });
    if (g) {
      const now = new Date(), cutoffDay = now.getUTCFullYear() === year ? now : end;
      const sameLast = new Date(Date.UTC(year - 1, cutoffDay.getUTCMonth(), cutoffDay.getUTCDate()));
      const last = await deliveredOrders("BUYER", ctx.company.id, yearRange(year - 1).start, sameLast);
      const lastKg = last.reduce((a, o) => a + Number(o.co2ProductsKg ?? 0) + Number(o.co2PackagingKg ?? 0) + Number(o.co2DeliveryKg ?? 0), 0);
      const pr = goalProgress(total, lastKg, Number(g.reductionPct));
      goal = { reductionPct: Number(g.reductionPct), thisYear: total, lastYear: r3(lastKg), ...pr };
    }
  }
  return {
    side, year, total, orders: orders.length, net: Math.round(net * 100) / 100, kgPerEuro: net > 0 ? Math.round((total / net) * 1000) / 1000 : null,
    localShare: orders.length ? Math.round((localOrders / orders.length) * 100) : null,
    parts: { products: r3(months.reduce((a, m) => a + m.products, 0)), packaging: r3(months.reduce((a, m) => a + m.packaging, 0)), delivery: r3(months.reduce((a, m) => a + m.delivery, 0)) },
    months: months.map((m) => ({ ...m, products: r3(m.products), packaging: r3(m.packaging), delivery: r3(m.delivery), total: r3(m.products + m.packaging + m.delivery) })),
    categories: [...byCat.entries()].map(([name, kg]) => ({ name, kg: r3(kg) })).sort((a, b) => b.kg - a.kg),
    parties: [...byParty.values()].map((x) => ({ ...x, kg: r3(x.kg), net: Math.round(x.net * 100) / 100 })).sort((a, b) => b.kg - a.kg).slice(0, 50),
    products: [...byProduct.entries()].map(([sku, x]) => ({ sku, name: x.name, kg: r3(x.kg) })).sort((a, b) => b.kg - a.kg).slice(0, 10),
    goal, settings: s,
  };
}

/** CSRD-style export (Scope 3, category 1 purchased goods + category 4 upstream transport): one row per month × category. */
export async function co2Csv(ctx: Ctx, side: Side, year: number, locale = "en") {
  const r = await co2ReportFor(ctx, side, year, locale);
  if (!r.settings.show.export) throw new ValidationError("FIRINGI has switched the CO₂ export off.");
  const { start, end } = yearRange(year);
  const orders = await deliveredOrders(side, side === "ADMIN" ? null : ctx.company.id, start, end);
  const cats = new Map((await prisma.category.findMany({ select: { id: true, name: true } })).map((c) => [c.id, pick(c.name, locale)]));
  const rows = new Map<string, { month: string; category: string; scope: string; kg: number }>();
  const add = (month: string, category: string, scope: string, kg: number) => { const k = `${month}|${category}|${scope}`; const x = rows.get(k) ?? { month, category, scope, kg: 0 }; x.kg += kg; rows.set(k, x); };
  for (const o of orders) {
    const month = o.co2At!.toISOString().slice(0, 7);
    for (const l of o.lines) add(month, cats.get(l.offer.packaging.variant.product.categoryId) ?? "?", "Scope 3 · Cat. 1 Purchased goods (incl. packaging)", Number(l.co2Kg ?? 0));
    add(month, "Delivery", "Scope 3 · Cat. 4 Upstream transportation", Number(o.co2DeliveryKg ?? 0));
  }
  const esc = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ["month,category,ghg_scope,kg_co2e", ...[...rows.values()].sort((a, b) => a.month.localeCompare(b.month) || a.category.localeCompare(b.category)).map((x) => [x.month, esc(x.category), esc(x.scope), r3(x.kg).toFixed(3)].join(","))];
  lines.push(`TOTAL,,,${r.total.toFixed(3)}`);
  return lines.join("\n") + "\n";
}

export async function setGoal(ctx: Ctx, year: number, reductionPct: number | null) {
  if (ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") throw new ForbiddenError();
  if (!(ctx.membership.isOwner || can(ctx, ["company.profile.manage", "buyer.orders.place"]))) throw new ForbiddenError();
  const s = await co2Settings();
  if (!s.show.goals || !(await co2Access(ctx.company, s)).buyer) throw new ValidationError("CO₂ goals are switched off.");
  if (!(year >= 2020 && year <= 2100)) throw new ValidationError("Check the year.");
  if (reductionPct == null) { await prisma.co2Goal.deleteMany({ where: { companyId: ctx.company.id, year } }); return; }
  if (!(reductionPct > 0 && reductionPct <= 90)) throw new ValidationError("A goal is between 1 and 90 % less CO₂.");
  await prisma.co2Goal.upsert({ where: { companyId_year: { companyId: ctx.company.id, year } }, create: { companyId: ctx.company.id, year, reductionPct: reductionPct.toFixed(2), createdById: ctx.user.id }, update: { reductionPct: reductionPct.toFixed(2), createdById: ctx.user.id } });
}

/** The buyer's goal for a year (null when none). */
export async function myGoal(ctx: Ctx, year: number) {
  const g = await prisma.co2Goal.findUnique({ where: { companyId_year: { companyId: ctx.company.id, year } }, select: { reductionPct: true } });
  return g ? Number(g.reductionPct) : null;
}

/** Suppliers' green grade (shop supplier pages, FIRINGI's overview). */
export async function supplierGrades(vendorIds: string[]) {
  const s = await co2Settings();
  if (!s.enabled || !s.show.supplierScore || !vendorIds.length) return new Map<string, { grade: string | null; score: number }>();
  const offers = await prisma.vendorOffer.findMany({ where: { vendorCompanyId: { in: vendorIds }, status: "ACTIVE" }, select: { id: true, vendorCompanyId: true }, take: 20000 });
  const fp = await offerFootprints(offers.map((o) => o.id), s);
  const by = new Map<string, { ratio: number; eco: boolean; own: boolean }[]>();
  for (const f of fp.values()) by.set(f.vendorId, [...(by.get(f.vendorId) ?? []), { ratio: f.ratio, eco: badges({ ...f, local: null }, s).includes("ECO_PACKAGING"), own: f.own }]);
  return new Map(vendorIds.map((id) => [id, supplierGrade(by.get(id) ?? [])]));
}

/** FIRINGI's overview: marketplace footprint this year, values waiting, coverage, supplier grades. */
export async function adminOverview(ctx: Ctx, year: number) {
  staff(ctx);
  const [report, pending, own, offers] = await Promise.all([co2ReportFor(ctx, "ADMIN", year).catch(() => null), prisma.offerCo2.count({ where: { status: "PENDING" } }), prisma.offerCo2.count({ where: { status: "APPROVED", kgPerKg: { not: null } } }), prisma.vendorOffer.count({ where: { status: "ACTIVE" } })]);
  const suppliers = await prisma.company.findMany({ where: { type: { in: ["WHOLESALER", "DISTRIBUTOR"] }, status: "APPROVED" }, select: { id: true, legalName: true, tradeName: true, type: true }, take: 300 });
  const grades = await supplierGrades(suppliers.map((x) => x.id));
  return { report, pending, coverage: offers ? Math.round((own / offers) * 100) : 0, ownValues: own, suppliers: suppliers.map((x) => ({ id: x.id, name: nameOf(x), type: x.type, ...(grades.get(x.id) ?? { grade: null, score: 0 }) })).sort((a, b) => b.score - a.score) };
}

export async function companySwitches(ctx: Ctx) {
  staff(ctx);
  const f = await prisma.companyFeature.findMany({ where: { key: FEATURE }, include: { company: { select: { id: true, legalName: true, tradeName: true, type: true } } } });
  return f.map((x) => ({ companyId: x.companyId, name: nameOf(x.company), type: x.company.type, state: x.enabled ? ("ON" as const) : ("OFF" as const) }));
}

/** Set a vehicle's fuel (FIRINGI or the vehicle's owner). */
export async function setVehicleFuel(ctx: Ctx, vehicleId: string, fuel: string | null) {
  const v = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { ownerCompanyId: true } });
  if (!v) throw new NotFoundError("Vehicle");
  if (ctx.company.type !== "ADMIN" && ctx.company.id !== v.ownerCompanyId) throw new ForbiddenError();
  if (fuel && !(FUELS as readonly string[]).includes(fuel)) throw new ValidationError("Choose the fuel.");
  await prisma.vehicle.update({ where: { id: vehicleId }, data: { fuel: fuel || null } });
}
