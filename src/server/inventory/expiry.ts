/**
 * Expiry features (Phase 24) — FIRINGI switches them per supplier; a supplier may ask for a change
 * and FIRINGI approves or rejects it.
 *   FEFO          orders take the batch that expires first (ledger.ts)
 *   EXPIRY_ALERTS daily: "N batches expire in 30 / 14 / 7 days", "N batches expired" + write-off list
 *   MARKDOWN      suggested discount for short-dated batches that won't sell in time — the supplier
 *                 decides (one click creates a normal supplier promotion ending on the best-before)
 *   SHOW_EXPIRY   customers see the best-before of what they would get, when it is close
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { isExpired } from "./ledger";
import { DEFAULTS_KEY, FEATURES, FIELD, SHORT_DATED_DAYS, inventoryDefaults, inventorySettings, type Feature, type Features } from "./settings";
import { daysLeft, requireInventory } from "./service";

const D = Prisma.Decimal;
const day = 86_400_000;
const todayUtc = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };

function requireStaff(ctx: Ctx, perm: "admin.inventory.view" | "admin.inventory.manage") {
  if (ctx.company.type !== "ADMIN" || !can(ctx, perm === "admin.inventory.view" ? ["admin.inventory.view", "admin.inventory.manage"] : perm)) throw new ForbiddenError();
}

// ───────────────────────────── FIRINGI: switches & requests ─────────────────────────────

export async function getDefaults(ctx: Ctx) {
  requireStaff(ctx, "admin.inventory.view");
  return inventoryDefaults(prisma);
}

export async function setDefaults(ctx: Ctx, f: Features) {
  requireStaff(ctx, "admin.inventory.manage");
  const value = { fefo: !!f.fefo, expiryAlerts: !!f.expiryAlerts, markdown: !!f.markdown, showExpiry: !!f.showExpiry };
  const before = await inventoryDefaults(prisma);
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: DEFAULTS_KEY } },
    update: { value, updatedById: ctx.user.id }, create: { scope: "GLOBAL", scopeId: "", key: DEFAULTS_KEY, value, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "inventory.defaults", entityType: "Setting", entityId: DEFAULTS_KEY, before, after: value });
}

/** Every approved supplier with its features (own switches or FIRINGI's defaults) and pending requests. */
export async function supplierFeatures(ctx: Ctx) {
  requireStaff(ctx, "admin.inventory.view");
  const [companies, defaults, pending] = await Promise.all([
    prisma.company.findMany({ where: { type: { in: ["DISTRIBUTOR", "WHOLESALER"] }, status: "APPROVED" }, select: { id: true, legalName: true, tradeName: true, type: true, isInHouse: true, inventorySettings: true }, orderBy: { legalName: "asc" } }),
    inventoryDefaults(prisma),
    prisma.inventoryFeatureRequest.groupBy({ by: ["companyId"], where: { status: "PENDING" }, _count: { _all: true } }),
  ]);
  return companies.map((c) => {
    const s = c.inventorySettings;
    return {
      id: c.id, name: c.tradeName ?? c.legalName, type: c.type, inHouse: c.isInHouse, custom: !!s,
      features: s ? { fefo: s.fefo, expiryAlerts: s.expiryAlerts, markdown: s.markdown, showExpiry: s.showExpiry } : defaults,
      pending: pending.find((p) => p.companyId === c.id)?._count._all ?? 0,
    };
  });
}

/** FIRINGI switches one feature of one supplier. `null` everywhere = back to FIRINGI's defaults. */
export async function setSupplierFeature(ctx: Ctx, companyId: string, feature: Feature, on: boolean, note?: string | null) {
  requireStaff(ctx, "admin.inventory.manage");
  if (!FEATURES.includes(feature)) throw new ValidationError("Unknown feature.");
  const c = await prisma.company.findFirst({ where: { id: companyId, type: { in: ["DISTRIBUTOR", "WHOLESALER"] } } });
  if (!c) throw new NotFoundError("Supplier");
  await prisma.$transaction(async (tx) => {
    const cur = await inventorySettings(tx, companyId);
    const next = { fefo: cur.fefo, expiryAlerts: cur.expiryAlerts, markdown: cur.markdown, showExpiry: cur.showExpiry, [FIELD[feature]]: on };
    await tx.inventorySettings.upsert({ where: { companyId }, update: { ...next, updatedById: ctx.user.id }, create: { companyId, ...next, updatedById: ctx.user.id } });
    // a pending request for the same thing is settled by this decision
    await tx.inventoryFeatureRequest.updateMany({ where: { companyId, feature, status: "PENDING" }, data: { status: "APPROVED", decidedById: ctx.user.id, decidedAt: new Date(), reason: note?.trim() || "Switched by FIRINGI" } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "inventory.feature_set", entityType: "Company", entityId: companyId, before: { [feature]: cur[FIELD[feature]] }, after: { [feature]: on, note: note?.trim() || null } }, tx);
  });
}

export async function resetSupplierFeatures(ctx: Ctx, companyId: string) {
  requireStaff(ctx, "admin.inventory.manage");
  await prisma.inventorySettings.deleteMany({ where: { companyId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "inventory.feature_reset", entityType: "Company", entityId: companyId });
}

export async function listFeatureRequests(ctx: Ctx, status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED") {
  requireStaff(ctx, "admin.inventory.view");
  const rows = await prisma.inventoryFeatureRequest.findMany({ where: status ? { status } : {}, include: { company: { select: { legalName: true, tradeName: true } } }, orderBy: [{ status: "asc" }, { requestedAt: "desc" }], take: 300 });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById].filter((x): x is string => !!x)))] } }, select: { id: true, name: true } });
  return rows.map((r) => ({ ...r, supplier: r.company.tradeName ?? r.company.legalName, requestedBy: users.find((u) => u.id === r.requestedById)?.name ?? "—", decidedBy: users.find((u) => u.id === r.decidedById)?.name ?? null }));
}

export async function decideFeatureRequest(ctx: Ctx, id: string, approve: boolean, reason?: string | null) {
  requireStaff(ctx, "admin.inventory.manage");
  const r = await prisma.inventoryFeatureRequest.findUnique({ where: { id } });
  if (!r) throw new NotFoundError("Request");
  if (r.status !== "PENDING") throw new ValidationError("This request was already decided.");
  if (!approve && !reason?.trim()) throw new ValidationError("Say why the request is rejected.");
  await prisma.$transaction(async (tx) => {
    if (approve) {
      const cur = await inventorySettings(tx, r.companyId);
      const next = { fefo: cur.fefo, expiryAlerts: cur.expiryAlerts, markdown: cur.markdown, showExpiry: cur.showExpiry, [FIELD[r.feature as Feature]]: r.enable };
      await tx.inventorySettings.upsert({ where: { companyId: r.companyId }, update: { ...next, updatedById: ctx.user.id }, create: { companyId: r.companyId, ...next, updatedById: ctx.user.id } });
    }
    await tx.inventoryFeatureRequest.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: ctx.user.id, decidedAt: new Date(), reason: reason?.trim() || null } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: approve ? "inventory.request_approved" : "inventory.request_rejected", entityType: "InventoryFeatureRequest", entityId: id, after: { feature: r.feature, enable: r.enable, reason: reason?.trim() || null } }, tx);
  });
}

// ───────────────────────────── supplier: my features & requests ─────────────────────────────

export async function myFeatures(ctx: Ctx) {
  requireInventory(ctx);
  const [f, requests] = await Promise.all([
    inventorySettings(prisma, ctx.company.id),
    prisma.inventoryFeatureRequest.findMany({ where: { companyId: ctx.company.id }, orderBy: { requestedAt: "desc" }, take: 20 }),
  ]);
  return { features: f, requests };
}

export async function requestFeature(ctx: Ctx, feature: Feature, enable: boolean, note?: string | null) {
  requireInventory(ctx, "vendor.inventory.manage");
  if (!FEATURES.includes(feature)) throw new ValidationError("Unknown feature.");
  const cur = await inventorySettings(prisma, ctx.company.id);
  if (cur[FIELD[feature]] === enable) throw new ValidationError(enable ? "This is already on." : "This is already off.");
  const open = await prisma.inventoryFeatureRequest.findFirst({ where: { companyId: ctx.company.id, feature, status: "PENDING" } });
  if (open) throw new ValidationError("You already asked FIRINGI about this — wait for the answer.");
  const r = await prisma.inventoryFeatureRequest.create({ data: { companyId: ctx.company.id, feature, enable, note: note?.trim()?.slice(0, 500) || null, requestedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "inventory.feature_requested", entityType: "InventoryFeatureRequest", entityId: r.id, after: { feature, enable } });
  return r;
}

export async function cancelFeatureRequest(ctx: Ctx, id: string) {
  requireInventory(ctx, "vendor.inventory.manage");
  const r = await prisma.inventoryFeatureRequest.findFirst({ where: { id, companyId: ctx.company.id, status: "PENDING" } });
  if (!r) throw new NotFoundError("Request");
  await prisma.inventoryFeatureRequest.update({ where: { id }, data: { status: "CANCELLED", decidedAt: new Date() } });
}

// ───────────────────────────── markdown suggestions ─────────────────────────────

/** Suggested discount by days left (the shorter, the deeper). */
export const markdownFor = (days: number) => (days <= 3 ? 40 : days <= 7 ? 25 : days <= SHORT_DATED_DAYS ? 15 : 0);

/**
 * Short-dated batches that won't sell in time at the usual pace (shipped in the last 28 days),
 * with a suggested discount. Only when FIRINGI has MARKDOWN on for the supplier.
 */
export async function markdownSuggestions(ctx: Ctx) {
  requireInventory(ctx);
  if (!(await inventorySettings(prisma, ctx.company.id)).markdown) return { enabled: false as const, rows: [] };
  const until = new Date(todayUtc().getTime() + SHORT_DATED_DAYS * day);
  const batches = await prisma.stockBatch.findMany({
    where: { offer: { vendorCompanyId: ctx.company.id, status: "ACTIVE" }, writtenOffAt: null, onHand: { gt: 0 }, expiresOn: { not: null, lte: until, gte: todayUtc() } },
    include: { offer: { select: { id: true, vendorSku: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } }, address: { select: { label: true } } },
    orderBy: { expiresOn: "asc" },
  });
  if (!batches.length) return { enabled: true as const, rows: [] };
  const since = new Date(Date.now() - 28 * day);
  const pace = await prisma.stockMovement.groupBy({ by: ["offerId"], where: { offerId: { in: batches.map((b) => b.offerId) }, type: "SHIPMENT", at: { gte: since } }, _sum: { qty: true } });
  const active = await prisma.promotion.findMany({ where: { ownerCompanyId: ctx.company.id, status: "ACTIVE", OR: [{ validTo: null }, { validTo: { gte: new Date() } }], targets: { some: { offerId: { in: batches.map((b) => b.offerId) } } } }, select: { id: true, value: true, kind: true, targets: { select: { offerId: true } } } });
  const rows = [];
  for (const b of batches) {
    const left = daysLeft(b.expiresOn)!;
    const free = b.onHand - b.reserved;
    if (free <= 0) continue;
    const perDay = (pace.find((p) => p.offerId === b.offerId)?._sum.qty ?? 0) / 28;
    const willSell = Math.floor(perDay * Math.max(left, 0));
    if (willSell >= free) continue; // sells in time at the usual pace
    const percent = markdownFor(left);
    if (!percent) continue;
    const promo = active.find((p) => p.targets.some((t) => t.offerId === b.offerId));
    rows.push({
      batchId: b.id, offerId: b.offerId, sku: b.offer.vendorSku, product: b.offer.packaging.variant.product.name, packaging: b.offer.packaging.name,
      warehouse: b.address.label, lotCode: b.lotCode, expiresOn: b.expiresOn!, daysLeft: left, free, perDay: Math.round(perDay * 10) / 10, unsold: free - willSell,
      percent, existingPromotion: promo ? { id: promo.id, kind: promo.kind, value: promo.value.toString() } : null,
    });
  }
  return { enabled: true as const, rows };
}

/** The supplier accepts a suggestion: a normal supplier promotion on that product until the best-before. */
export async function acceptMarkdown(ctx: Ctx, batchId: string, percent: number) {
  requireInventory(ctx, "vendor.inventory.manage");
  if (!(await inventorySettings(prisma, ctx.company.id)).markdown) throw new ForbiddenError();
  if (!Number.isFinite(percent) || percent < 1 || percent > 90) throw new ValidationError("Discount must be 1–90 %.");
  const b = await prisma.stockBatch.findFirst({ where: { id: batchId, offer: { vendorCompanyId: ctx.company.id }, writtenOffAt: null }, include: { offer: { select: { packaging: { select: { variant: { select: { product: { select: { name: true } } } } } } } } } });
  if (!b || !b.expiresOn) throw new NotFoundError("Batch");
  if (isExpired(b.expiresOn)) throw new ValidationError("This batch has already expired — write it off instead.");
  const { saveVendorPromotion } = await import("@/server/services/promotions");
  const nm = b.offer.packaging.variant.product.name as Record<string, string>;
  const date = b.expiresOn.toISOString().slice(0, 10);
  const end = new Date(b.expiresOn.getTime() + day - 1000);
  const p = await saveVendorPromotion(ctx, {
    name: { en: `Short-dated ${nm.en ?? nm.pt ?? ""} (best before ${date})`.slice(0, 120), pt: `Validade curta ${nm.pt ?? nm.en ?? ""} (consumir até ${date})`.slice(0, 120) },
    kind: "PERCENT", value: percent, validFrom: new Date(), validTo: end, targets: { offerIds: [b.offerId] },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "inventory.markdown_accepted", entityType: "StockBatch", entityId: b.id, after: { percent, promotionId: p.id, suggestedBy: "AI" } });
  return p;
}

// ───────────────────────────── customers: best-before ─────────────────────────────

/**
 * Best-before a customer would get for these offers (FEFO: the first usable batch), only for
 * suppliers with SHOW_EXPIRY on and only when it is within `withinDays`. offerId → date.
 */
export async function bestBeforeFor(offerIds: string[], withinDays = 30): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (!offerIds.length) return out;
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: offerIds } }, select: { id: true, vendorCompanyId: true } });
  const vendors = [...new Set(offers.map((o) => o.vendorCompanyId))];
  const on = new Set<string>();
  for (const v of vendors) if ((await inventorySettings(prisma, v)).showExpiry) on.add(v);
  const ids = offers.filter((o) => on.has(o.vendorCompanyId)).map((o) => o.id);
  if (!ids.length) return out;
  const today = todayUtc();
  const rows = await prisma.stockBatch.findMany({
    where: { offerId: { in: ids }, writtenOffAt: null, expiresOn: { gte: today } },
    select: { offerId: true, expiresOn: true, onHand: true, reserved: true }, orderBy: { expiresOn: "asc" },
  });
  for (const r of rows) {
    if (out.has(r.offerId) || r.onHand - r.reserved <= 0 || !r.expiresOn) continue;
    if (r.expiresOn.getTime() - today.getTime() <= withinDays * day) out.set(r.offerId, r.expiresOn);
    else out.set(r.offerId, new Date(0)); // far enough: nothing to show (marker so later batches don't count)
  }
  for (const [k, v] of out) if (v.getTime() === 0) out.delete(k);
  return out;
}

// ───────────────────────────── daily job ─────────────────────────────

/** Expiry alerts are for goods bought on FIRINGI (see purchased.ts). */
export async function runExpiryAlerts() {
  const { runPurchaseExpiryAlerts } = await import("./purchased");
  return runPurchaseExpiryAlerts();
}
