/**
 * Phase 47 — POS: set-up (tills, items, recipes, loyalty, the certified provider, cashier PINs), shifts with X/Z
 * reports and cash, open tables, reports, the till's snapshot (what it needs to keep selling offline), the
 * restaurant's ingredient stock with reorder hints, and FIRINGI's admin views.
 */
import "server-only";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { pickLocalized } from "@/i18n/config";
import { POS_PROVIDER_INFO, RECIPE_UNITS, packsOf, posAllowed, reorderHint, zReport, type PosProvider, type ZSale } from "@/lib/pos";
import { posAccess, posSettings, requirePos } from "./settings";
import { hint, pinHash, seal } from "./secret";
import { ownRegister } from "./sales";
import { tillAccess } from "./access";

const D = (v: Decimal.Value) => new Decimal(v || 0);
const n2 = (v: unknown) => Number(v ?? 0);
const clean = (v: string | null | undefined, max = 200) => (v ?? "").trim().slice(0, max) || null;

/** The company's POS row (created with defaults on first use). */
async function posCompany(companyId: string) {
  return prisma.posCompany.upsert({ where: { companyId }, update: {}, create: { companyId } });
}

// ── set-up ──────────────────────────────────────────────────────────────────

export async function posSetup(ctx: Ctx) {
  const access = await requirePos(ctx, "manage");
  const [pc, registers, warehouses, people, pins] = await Promise.all([
    posCompany(ctx.company.id),
    prisma.posRegister.findMany({ where: { companyId: ctx.company.id }, orderBy: { code: "asc" }, include: { shifts: { where: { status: "OPEN" }, select: { id: true, number: true, openedAt: true } }, users: { select: { userId: true, role: true } } } }),
    prisma.address.findMany({ where: { companyId: ctx.company.id, isActive: true, kind: { in: ["WAREHOUSE", "PICKUP"] } }, select: { id: true, label: true, cityName: true }, orderBy: { createdAt: "asc" } }),
    cashiers(ctx.company.id),
    prisma.posPin.findMany({ where: { companyId: ctx.company.id }, select: { userId: true } }),
  ]);
  const withPin = new Set(pins.map((p) => p.userId));
  const branches = await prisma.branch.findMany({ where: { companyId: ctx.company.id, isActive: true }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } });
  return {
    access: { ...access, company: undefined, settings: { features: access.settings.features } },
    company: { ...pc, fiscalSecretEnc: undefined },
    registers, warehouses, branches, tillsWithoutApproval: access.settings.tillsWithoutApproval, people: people.map((p) => ({ ...p, hasPin: withPin.has(p.userId) })),
    providers: Object.entries(POS_PROVIDER_INFO).filter(([, v]) => v.countries.includes(access.countryCode)).map(([k, v]) => ({ key: k as PosProvider, name: v.name, about: v.about })),
  };
}

export type PosCompanyInput = {
  receiptHeader?: string | null; receiptFooter?: string | null; loyaltyOn?: boolean; pointsPerUnit?: number; pointValue?: number; minRedeem?: number;
  discountLimit?: number; refundDays?: number; emailReceipts?: boolean; postToAccounting?: boolean;
};

export async function savePosCompany(ctx: Ctx, i: PosCompanyInput) {
  await requirePos(ctx, "manage");
  const num = (v: number | undefined, min: number, max: number) => (v === undefined ? undefined : Math.min(max, Math.max(min, v)));
  await posCompany(ctx.company.id);
  const row = await prisma.posCompany.update({
    where: { companyId: ctx.company.id },
    data: {
      ...(i.receiptHeader !== undefined ? { receiptHeader: clean(i.receiptHeader, 300) } : {}),
      ...(i.receiptFooter !== undefined ? { receiptFooter: clean(i.receiptFooter, 300) } : {}),
      ...(i.loyaltyOn !== undefined ? { loyaltyOn: i.loyaltyOn } : {}),
      ...(i.pointsPerUnit !== undefined ? { pointsPerUnit: num(i.pointsPerUnit, 0, 100) } : {}),
      ...(i.pointValue !== undefined ? { pointValue: num(i.pointValue, 0, 100) } : {}),
      ...(i.minRedeem !== undefined ? { minRedeem: Math.round(num(i.minRedeem, 0, 1_000_000)!) } : {}),
      ...(i.discountLimit !== undefined ? { discountLimit: num(i.discountLimit, 0, 100) } : {}),
      ...(i.refundDays !== undefined ? { refundDays: Math.round(num(i.refundDays, 0, 365)!) } : {}),
      ...(i.emailReceipts !== undefined ? { emailReceipts: i.emailReceipts } : {}),
      ...(i.postToAccounting !== undefined ? { postToAccounting: i.postToAccounting } : {}),
    },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pos.company", entityType: "PosCompany", entityId: ctx.company.id });
  return { ...row, fiscalSecretEnc: undefined };
}

/** The business's own account with its certified provider (the secret is stored sealed; only a hint is shown). */
export async function saveFiscalConnection(ctx: Ctx, i: { provider: string | null; account: string; secret: string }) {
  const access = await requirePos(ctx, "manage");
  await posCompany(ctx.company.id);
  if (!i.provider) {
    await prisma.posCompany.update({ where: { companyId: ctx.company.id }, data: { fiscalProvider: null, fiscalAccount: null, fiscalSecretEnc: null, fiscalSecretHint: null, fiscalTestedAt: null, fiscalTestOk: null } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pos.fiscal.disconnect", entityType: "PosCompany", entityId: ctx.company.id });
    return { connected: false };
  }
  const info = POS_PROVIDER_INFO[i.provider as PosProvider];
  if (!info || !info.countries.includes(access.countryCode)) throw new ValidationError("This provider isn't offered in your country.");
  if (!i.account.trim()) throw new ValidationError("Enter your account / device id with the provider.");
  if (i.secret.trim().length < 6) throw new ValidationError("Enter the provider's API key / secret.");
  await prisma.posCompany.update({ where: { companyId: ctx.company.id }, data: { fiscalProvider: i.provider, fiscalAccount: i.account.trim().slice(0, 120), fiscalSecretEnc: seal(i.secret.trim()), fiscalSecretHint: hint(i.secret.trim()), fiscalTestedAt: null, fiscalTestOk: null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pos.fiscal.connect", entityType: "PosCompany", entityId: ctx.company.id, after: { provider: i.provider, account: i.account.trim() } });
  const { testConnection } = await import("./fiscal");
  return { connected: true, test: await testConnection(ctx.company.id) };
}

export async function saveRegister(ctx: Ctx, i: { id?: string | null; name: string; code: string; addressId?: string | null; branchId?: string | null; active?: boolean }) {
  await requirePos(ctx, "manage");
  const code = i.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,6}$/.test(code)) throw new ValidationError("The till code is 1–6 letters or digits (printed on receipts).");
  if (!i.name.trim()) throw new ValidationError("Give the till a name.");
  if (i.addressId) {
    const a = await prisma.address.findFirst({ where: { id: i.addressId, companyId: ctx.company.id, isActive: true } });
    if (!a) throw new ValidationError("Choose one of your warehouses.");
  }
  if (i.branchId) {
    const b = await prisma.branch.findFirst({ where: { id: i.branchId, companyId: ctx.company.id, isActive: true } });
    if (!b) throw new ValidationError("Choose one of your shops.");
  }
  const clash = await prisma.posRegister.findFirst({ where: { companyId: ctx.company.id, code, ...(i.id ? { NOT: { id: i.id } } : {}) } });
  if (clash) throw new ValidationError("Another till has this code.");
  const data = { name: i.name.trim().slice(0, 60), code, addressId: i.addressId || null, ...(i.branchId !== undefined ? { branchId: i.branchId || null } : {}), active: i.active ?? true };
  let r;
  if (i.id) {
    await ownCompanyRegister(ctx, i.id);
    r = await prisma.posRegister.update({ where: { id: i.id }, data });
  } else {
    // the first tills are ready at once; each further till waits for FIRINGI's approval
    const s = await posSettings();
    const have = await prisma.posRegister.count({ where: { companyId: ctx.company.id, approval: { in: ["APPROVED", "PENDING"] } } });
    const pending = have >= s.tillsWithoutApproval;
    r = await prisma.posRegister.create({ data: { ...data, companyId: ctx.company.id, approval: pending ? "PENDING" : "APPROVED", requestedById: ctx.user.id } });
    if (pending) {
      const { notify } = await import("@/server/notify/dispatch");
      const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
      if (admin) await notify("pos.till_requested", [{ companyId: admin.id }], { company: ctx.company.tradeName ?? ctx.company.legalName, till: `${r.name} (${r.code})` }, { ref: { type: "PosRegister", id: r.id } }).catch(() => null);
    }
  }
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: i.id ? "pos.register.update" : "pos.register.create", entityType: "PosRegister", entityId: r.id });
  return r;
}

async function ownCompanyRegister(ctx: Ctx, id: string) {
  const r = await prisma.posRegister.findUnique({ where: { id } });
  if (!r || r.companyId !== ctx.company.id) throw new NotFoundError("Till not found.");
  return r;
}

/** Who may use a till: nobody listed = everyone with the till right; else only those listed (cashier / shop manager). */
export async function setRegisterUsers(ctx: Ctx, registerId: string, users: { userId: string; role: "SELL" | "MANAGE" }[]) {
  await requirePos(ctx, "manage");
  const a = await tillAccess(ctx.company.id, ctx.user.id);
  if (!a.companyManage) throw new ForbiddenError();
  const r = await ownCompanyRegister(ctx, registerId);
  const people = new Set((await cashiers(ctx.company.id)).map((p) => p.userId));
  for (const u of users) if (!people.has(u.userId)) throw new ValidationError("Only people with the till right can be given a till (Team › roles: Cashier / Shop Manager).");
  const before = await prisma.posRegisterUser.findMany({ where: { registerId: r.id } });
  await prisma.$transaction([
    prisma.posRegisterUser.deleteMany({ where: { registerId: r.id } }),
    ...users.map((u) => prisma.posRegisterUser.create({ data: { registerId: r.id, userId: u.userId, role: u.role === "MANAGE" ? "MANAGE" : "SELL" } })),
  ]);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pos.register.people", entityType: "PosRegister", entityId: r.id, before: before.map((b) => ({ userId: b.userId, role: b.role })), after: users });
  return { ok: true };
}

/** The company's people who may sell (for PINs and reports). */
async function cashiers(companyId: string) {
  const ms = await prisma.membership.findMany({
    where: { companyId, status: "ACTIVE" },
    select: { userId: true, isOwner: true, user: { select: { name: true, email: true } }, roles: { select: { role: { select: { permissions: { select: { permissionCode: true } } } } } } },
  });
  return ms.map((m) => {
    const codes = new Set(m.roles.flatMap((r) => r.role.permissions.map((p) => p.permissionCode)));
    const manager = m.isOwner || codes.has("company.pos.manage");
    return { userId: m.userId, name: m.user.name, email: m.user.email, manager, sells: manager || codes.has("company.pos.sell") };
  }).filter((m) => m.sells);
}

/** A cashier sets their own PIN; a manager can set anyone's. */
export async function setPin(ctx: Ctx, userId: string, pin: string) {
  await requirePos(ctx, "sell");
  if (userId !== ctx.user.id && !can(ctx, "company.pos.manage")) throw new ForbiddenError();
  if (!/^\d{4,8}$/.test(pin)) throw new ValidationError("The PIN is 4 to 8 digits.");
  const people = await cashiers(ctx.company.id);
  if (!people.some((p) => p.userId === userId)) throw new ValidationError("This person can't sell at the till.");
  const others = await prisma.posPin.findMany({ where: { companyId: ctx.company.id, NOT: { userId } } });
  if (others.some((o) => o.pinHash === pinHash(ctx.company.id, o.userId, pin))) throw new ValidationError("Choose another PIN.");
  await prisma.posPin.upsert({ where: { companyId_userId: { companyId: ctx.company.id, userId } }, update: { pinHash: pinHash(ctx.company.id, userId, pin) }, create: { companyId: ctx.company.id, userId, pinHash: pinHash(ctx.company.id, userId, pin) } });
  return { ok: true };
}

/** Whose PIN this is (online check; the till also checks offline against the hashes in its snapshot). */
export async function verifyPin(ctx: Ctx, pin: string, needManager = false) {
  await requirePos(ctx, "sell");
  const [pins, people] = await Promise.all([prisma.posPin.findMany({ where: { companyId: ctx.company.id } }), cashiers(ctx.company.id)]);
  const hit = pins.find((p) => p.pinHash === pinHash(ctx.company.id, p.userId, pin));
  const person = hit ? people.find((p) => p.userId === hit.userId) : null;
  if (!person) throw new ValidationError("Wrong PIN.");
  if (needManager && !person.manager) throw new ForbiddenError("This needs a manager's PIN.");
  return { userId: person.userId, name: person.name, manager: person.manager };
}

// ── items, recipes ─────────────────────────────────────────────────────────

export async function listItems(ctx: Ctx) {
  const access = await requirePos(ctx, "sell");
  const items = await prisma.posItem.findMany({ where: { companyId: ctx.company.id }, orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }], include: { recipe: true } });
  // a supplier sees the stock of each linked product across its warehouses
  const offerIds = [...new Set(items.map((i) => i.offerId).filter(Boolean) as string[])];
  const levels = offerIds.length ? await prisma.stockLevel.groupBy({ by: ["offerId"], where: { offerId: { in: offerIds } }, _sum: { onHand: true, reserved: true } }) : [];
  const stock = new Map(levels.map((l) => [l.offerId, (l._sum.onHand ?? 0) - (l._sum.reserved ?? 0)]));
  return { items: items.map((i) => ({ ...i, stock: i.offerId ? stock.get(i.offerId) ?? 0 : null })), currency: access.currency, type: access.type };
}

export type ItemInput = {
  id?: string | null; name: string; category?: string | null; barcode?: string | null; plu?: string | null; price: number; vatRate: number; byWeight?: boolean;
  offerId?: string | null; stockPerUnit?: number; restriction?: string | null; allergens?: string[]; color?: string | null; quick?: boolean; kitchen?: boolean; active?: boolean; sortOrder?: number;
  /** the tills (shops) that sell it; empty = every till */
  registerIds?: string[];
};

export async function saveItem(ctx: Ctx, i: ItemInput) {
  const access = await requirePos(ctx, "manage");
  if (!i.name.trim()) throw new ValidationError("Give the item a name.");
  if (!(i.price >= 0) || i.price > 1_000_000) throw new ValidationError("Check the price.");
  if (!(i.vatRate >= 0) || i.vatRate > 50) throw new ValidationError("Check the VAT rate.");
  if (i.barcode && !/^[0-9A-Za-z-]{4,40}$/.test(i.barcode)) throw new ValidationError("Check the barcode.");
  if (i.plu && !/^\d{1,6}$/.test(i.plu)) throw new ValidationError("The scale code (PLU) is up to 6 digits.");
  if (i.offerId) {
    if (access.type === "CUSTOMER") throw new ValidationError("Link ingredients through the recipe.");
    const o = await prisma.vendorOffer.findFirst({ where: { id: i.offerId, vendorCompanyId: ctx.company.id } });
    if (!o) throw new ValidationError("Choose one of your own products.");
  }
  if (i.barcode) {
    const dup = await prisma.posItem.findFirst({ where: { companyId: ctx.company.id, barcode: i.barcode, active: true, ...(i.id ? { NOT: { id: i.id } } : {}) } });
    if (dup) throw new ValidationError(`The barcode is already on "${dup.name}".`);
  }
  const { ALLERGENS } = await import("@/lib/food");
  const allergens = (i.allergens ?? []).filter((a) => (ALLERGENS as readonly string[]).includes(a));
  const ownTills = new Set((await prisma.posRegister.findMany({ where: { companyId: ctx.company.id }, select: { id: true } })).map((r) => r.id));
  const registerIds = [...new Set(i.registerIds ?? [])];
  if (registerIds.some((r) => !ownTills.has(r))) throw new ValidationError("Choose your own tills.");
  const data = {
    name: i.name.trim().slice(0, 80), category: clean(i.category, 40), barcode: clean(i.barcode, 40), plu: clean(i.plu, 6), price: D(i.price).toDecimalPlaces(4).toString(), vatRate: D(i.vatRate).toDecimalPlaces(2).toString(),
    byWeight: !!i.byWeight, offerId: i.offerId || null, stockPerUnit: D(i.stockPerUnit ?? 1).gt(0) ? D(i.stockPerUnit ?? 1).toString() : "1", restriction: i.restriction === "ALCOHOL" || i.restriction === "TOBACCO" ? i.restriction : null,
    allergens, color: i.color && /^#[0-9a-f]{6}$/i.test(i.color) ? i.color : null, quick: i.quick ?? true, kitchen: !!i.kitchen, active: i.active ?? true, sortOrder: Math.round(i.sortOrder ?? 0), registerIds,
  };
  if (i.id) {
    const own = await prisma.posItem.findFirst({ where: { id: i.id, companyId: ctx.company.id } });
    if (!own) throw new NotFoundError();
    return prisma.posItem.update({ where: { id: i.id }, data });
  }
  return prisma.posItem.create({ data: { ...data, companyId: ctx.company.id } });
}

/** A supplier fills the till from its own products: name, barcode, retail price (its price list + VAT), VAT, age and allergen flags. */
export async function importFromCatalogue(ctx: Ctx, locale = "en") {
  const access = await requirePos(ctx, "manage");
  if (access.type === "CUSTOMER") throw new ValidationError("Only suppliers sell their own catalogue at the till.");
  const linked = new Set((await prisma.posItem.findMany({ where: { companyId: ctx.company.id, offerId: { not: null } }, select: { offerId: true } })).map((i) => i.offerId));
  const offers = await prisma.vendorOffer.findMany({
    where: { vendorCompanyId: ctx.company.id, status: "ACTIVE" },
    include: { packaging: { include: { variant: { include: { product: { include: { category: { select: { name: true } } } } } } } }, prices: { where: { minQty: { lte: 1 }, priceList: { isActive: true } }, orderBy: { unitPriceNet: "asc" }, take: 1 } },
    take: 500,
  });
  const { vatRate } = await import("@/server/services/orders");
  let added = 0;
  for (const o of offers) {
    if (linked.has(o.id)) continue;
    const p = o.packaging.variant.product;
    const net = o.prices[0]?.unitPriceNet;
    if (!net) continue;
    const rate = await vatRate(prisma, ctx.company.countryId, null, p.taxCategoryId).catch(() => null);
    const r = rate == null ? 23 : Number(rate);
    const name = `${pickLocalized(p.name as never, locale)} ${pickLocalized(o.packaging.name as never, locale)}`.trim();
    await prisma.posItem.create({
      data: {
        companyId: ctx.company.id, name: name.slice(0, 80), category: pickLocalized(p.category?.name as never, locale)?.slice(0, 40) || null,
        barcode: o.packaging.gtin ?? o.packaging.variant.gtin ?? null, plu: o.cwPlu ?? null, byWeight: o.cwMode === "KG",
        price: D(net.toString()).mul(D(1).plus(D(r).div(100))).toDecimalPlaces(2).toString(), vatRate: String(r), offerId: o.id,
        restriction: p.restriction ?? null, allergens: p.allergensContain ?? [],
      },
    });
    added++;
  }
  return { added };
}

/** What a restaurant has bought on FIRINGI (the ingredients a recipe can use). */
export async function purchasedOffers(ctx: Ctx, locale = "en") {
  await requirePos(ctx, "manage");
  const lots = await prisma.purchasedLot.groupBy({ by: ["offerId"], where: { buyerCompanyId: ctx.company.id }, _sum: { qty: true, usedQty: true } });
  const ordered = await prisma.orderLine.findMany({ where: { order: { buyerCompanyId: ctx.company.id } }, select: { offerId: true }, distinct: ["offerId"], take: 300 }).catch(() => [] as { offerId: string }[]);
  const ids = [...new Set([...lots.map((l) => l.offerId), ...ordered.map((o) => o.offerId)])];
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: ids } }, include: { packaging: { include: { variant: { include: { product: { select: { name: true, allergensContain: true } } } } } } } });
  const left = new Map(lots.map((l) => [l.offerId, (l._sum.qty ?? 0) - (l._sum.usedQty ?? 0)]));
  return offers.map((o) => ({
    offerId: o.id, name: `${pickLocalized(o.packaging.variant.product.name as never, locale)} — ${pickLocalized(o.packaging.name as never, locale)}`,
    netWeightKg: o.packaging.netWeightKg ? Number(o.packaging.netWeightKg) : null, unitsPerPack: o.packaging.unitsPerPack, allergens: o.packaging.variant.product.allergensContain ?? [],
    packsLeft: left.get(o.id) ?? 0,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveRecipe(ctx: Ctx, itemId: string, lines: { offerId: string; qty: number; unit: string }[], locale = "en") {
  await requirePos(ctx, "manage");
  const item = await prisma.posItem.findFirst({ where: { id: itemId, companyId: ctx.company.id } });
  if (!item) throw new NotFoundError();
  const allowed = new Map((await purchasedOffers(ctx, locale)).map((o) => [o.offerId, o]));
  for (const l of lines) {
    if (!allowed.has(l.offerId)) throw new ValidationError("A recipe uses only what you bought on FIRINGI.");
    if (!(l.qty > 0) || l.qty > 10_000) throw new ValidationError("Check the recipe quantities.");
    if (!(RECIPE_UNITS as readonly string[]).includes(l.unit)) throw new ValidationError("Choose kg, pieces or packs.");
  }
  await prisma.$transaction([
    prisma.posRecipeLine.deleteMany({ where: { itemId } }),
    ...lines.map((l) => prisma.posRecipeLine.create({ data: { itemId, offerId: l.offerId, qty: D(l.qty).toDecimalPlaces(4).toString(), unit: l.unit } })),
  ]);
  // the dish carries its ingredients' allergens unless the business set its own
  if (!item.allergens.length) {
    const all = [...new Set(lines.flatMap((l) => allowed.get(l.offerId)?.allergens ?? []))];
    if (all.length) await prisma.posItem.update({ where: { id: itemId }, data: { allergens: all } });
  }
  return prisma.posItem.findUniqueOrThrow({ where: { id: itemId }, include: { recipe: true } });
}

// ── guests (loyalty) ───────────────────────────────────────────────────────

export async function listMembers(ctx: Ctx, q = "") {
  await requirePos(ctx, "sell");
  return prisma.posMember.findMany({
    where: { companyId: ctx.company.id, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q } }, { phone: { contains: q } }, { email: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: { createdAt: "desc" }, take: 200,
  });
}

export async function saveMember(ctx: Ctx, i: { id?: string | null; name: string; code?: string | null; phone?: string | null; email?: string | null; consent: boolean }) {
  await requirePos(ctx, "sell");
  if (!i.name.trim()) throw new ValidationError("Enter the guest's name.");
  if (!i.consent) throw new ValidationError("The guest must agree to the loyalty card (their name and contact are kept).");
  if (i.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(i.email)) throw new ValidationError("Check the e-mail.");
  const code = (i.code?.trim() || i.phone?.replace(/\D/g, "") || String(Math.floor(10_000_000 + Math.random() * 89_999_999))).slice(0, 32);
  const clash = await prisma.posMember.findFirst({ where: { companyId: ctx.company.id, code, ...(i.id ? { NOT: { id: i.id } } : {}) } });
  if (clash) throw new ValidationError("Another guest has this card number.");
  const data = { name: i.name.trim().slice(0, 80), code, phone: clean(i.phone, 30), email: clean(i.email, 200) };
  if (i.id) {
    const own = await prisma.posMember.findFirst({ where: { id: i.id, companyId: ctx.company.id } });
    if (!own) throw new NotFoundError();
    return prisma.posMember.update({ where: { id: i.id }, data });
  }
  return prisma.posMember.create({ data: { ...data, companyId: ctx.company.id, consentAt: new Date() } });
}

// ── shifts, cash ───────────────────────────────────────────────────────────

export async function openShift(ctx: Ctx, registerId: string, openingFloat: number) {
  await requirePos(ctx, "sell");
  const r = await ownRegister(ctx, registerId);
  if (!r.active) throw new ValidationError("This till is switched off.");
  if (!(openingFloat >= 0)) throw new ValidationError("Check the opening cash.");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PosRegister" WHERE id = ${r.id} FOR UPDATE`;
    const open = await tx.posShift.findFirst({ where: { registerId: r.id, status: "OPEN" } });
    if (open) return open;
    const reg = await tx.posRegister.update({ where: { id: r.id }, data: { shiftCount: { increment: 1 } } });
    return tx.posShift.create({ data: { registerId: r.id, number: reg.shiftCount, openedById: ctx.user.id, openingFloat: D(openingFloat).toFixed(2) } });
  });
}

async function ownShift(ctx: Ctx, shiftId: string) {
  const s = await prisma.posShift.findUnique({ where: { id: shiftId }, include: { register: true } });
  if (!s || s.register.companyId !== ctx.company.id) throw new NotFoundError("Shift not found.");
  if (!(await tillAccess(ctx.company.id, ctx.user.id)).sell.has(s.registerId)) throw new ForbiddenError("You can't use this till.");
  return s;
}

/** The X report (shift so far) or the Z report as closed. */
export async function shiftReport(ctx: Ctx, shiftId: string) {
  await requirePos(ctx, "sell");
  const s = await ownShift(ctx, shiftId);
  const [sales, cash, people] = await Promise.all([
    prisma.posSale.findMany({ where: { shiftId }, include: { payments: true, lines: { select: { vatRate: true, net: true, vat: true, gross: true } } } }),
    prisma.posCashMove.findMany({ where: { shiftId } }),
    cashiers(ctx.company.id),
  ]);
  const z = zReport(sales.map(toZ), cash.map((c) => ({ kind: c.kind, amount: n2(c.amount) })), n2(s.openingFloat));
  const names = Object.fromEntries(people.map((p) => [p.userId, p.name]));
  return { shift: s, report: s.status === "CLOSED" && s.zReport ? (s.zReport as unknown as typeof z) : z, names, cash };
}

const toZ = (s: { kind: "SALE" | "REFUND"; status: string; gross: unknown; net: unknown; vat: unknown; discount: unknown; cashierId: string; payments: { method: string; amount: unknown }[]; lines: { vatRate: unknown; net: unknown; vat: unknown; gross: unknown }[] }): ZSale => {
  const rates = new Map<number, { net: number; vat: number; gross: number }>();
  for (const l of s.lines) { const r = n2(l.vatRate); const c = rates.get(r) ?? { net: 0, vat: 0, gross: 0 }; rates.set(r, { net: c.net + n2(l.net), vat: c.vat + n2(l.vat), gross: c.gross + n2(l.gross) }); }
  return { kind: s.kind, status: s.status, gross: n2(s.gross), net: n2(s.net), vat: n2(s.vat), discount: n2(s.discount), cashierId: s.cashierId, payments: s.payments.map((p) => ({ method: p.method, amount: n2(p.amount) })), byRate: [...rates].map(([rate, v]) => ({ rate, ...v })) };
};

export async function cashMove(ctx: Ctx, i: { shiftId: string; kind: "PAY_IN" | "PAY_OUT" | "NO_SALE"; amount: number; reason?: string | null; approvedById?: string | null }) {
  await requirePos(ctx, "sell");
  const s = await ownShift(ctx, i.shiftId);
  if (s.status !== "OPEN") throw new ValidationError("The shift is closed.");
  if (i.kind !== "NO_SALE" && !(i.amount > 0)) throw new ValidationError("Enter the amount.");
  if (i.kind !== "PAY_IN" && !(i.reason ?? "").trim()) throw new ValidationError("Give a reason.");
  const { isPosManager } = await import("./sales");
  const manager = (await tillAccess(ctx.company.id, ctx.user.id)).manage.has(s.registerId) || (await isPosManager(ctx.company.id, i.approvedById, s.registerId));
  if (i.kind === "PAY_OUT" && !manager) throw new ForbiddenError("Taking cash out needs a manager's PIN.");
  return prisma.posCashMove.create({ data: { shiftId: s.id, kind: i.kind, amount: i.kind === "NO_SALE" ? 0 : D(i.amount).toFixed(2), reason: clean(i.reason, 200), byUserId: ctx.user.id, approvedById: i.approvedById || null } });
}

/** Close the shift: count the cash, keep the Z report, post the day into the company's accounting. */
export async function closeShift(ctx: Ctx, i: { shiftId: string; countedCash: number; note?: string | null }) {
  await requirePos(ctx, "sell");
  const s = await ownShift(ctx, i.shiftId);
  if (s.status !== "OPEN") throw new ValidationError("The shift is already closed.");
  if (!(i.countedCash >= 0)) throw new ValidationError("Count the cash in the drawer.");
  const { report } = await shiftReport(ctx, s.id);
  const diff = D(i.countedCash).minus(report.expectedCash);
  const closed = await prisma.posShift.update({
    where: { id: s.id },
    data: { status: "CLOSED", closedAt: new Date(), closedById: ctx.user.id, countedCash: D(i.countedCash).toFixed(2), expectedCash: D(report.expectedCash).toFixed(2), difference: diff.toFixed(2), zReport: report as never, note: clean(i.note, 300) },
  });
  // the day's sales go into the company's Accounting (rebuilt each night too)
  const days = await prisma.posSale.findMany({ where: { shiftId: s.id }, select: { soldAt: true }, distinct: ["soldAt"] });
  let posted = 0;
  for (const d of new Set(days.map((x) => x.soldAt.toISOString().slice(0, 10)))) posted += await postDailyTillSales(ctx.company.id, d);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pos.shift.close", entityType: "PosShift", entityId: s.id, after: { gross: report.gross, expectedCash: report.expectedCash, counted: i.countedCash } });
  return { shift: closed, report, posted };
}

/**
 * The till's sales into the company's own Accounting, every day: one entry per payment kind (cash, card — MB WAY
 * counts as card —, other) and VAT rate, refunds taken off, points left out (no money). A day is rebuilt each time
 * (shift close, and the nightly run over the last week, so sales sent late by a till that was offline still count),
 * so nothing is posted twice.
 */
export async function postDailyTillSales(companyId: string, day: string) {
  const s = await posSettings();
  const pc = await prisma.posCompany.findUnique({ where: { companyId }, select: { postToAccounting: true } });
  if (!s.features.accounting || pc?.postToAccounting === false) return 0;
  const from = new Date(`${day}T00:00:00.000Z`), to = new Date(from.getTime() + 86_400_000);
  const sales = await prisma.posSale.findMany({ where: { companyId, status: "COMPLETED", soldAt: { gte: from, lt: to } }, include: { payments: true, lines: { select: { vatRate: true, gross: true } }, register: { select: { branchId: true, code: true } } } });
  const cat = (m: string) => (m === "CASH" ? "SALES_CASH" : m === "CARD" || m === "MBWAY" ? "SALES_CARD" : "SALES_OTHER");
  // amount per (branch, category, VAT rate): each sale's money payments spread over its VAT rates
  // per till (and so per shop): a grocery and a restaurant keep their own books
  const sums = new Map<string, { branchId: string | null; till: string; category: string; vatRate: string; amount: Decimal }>();
  for (const sale of sales) {
    const sign = sale.kind === "REFUND" ? -1 : 1;
    const gross = D(sale.gross.toString());
    if (gross.isZero()) continue;
    const rates = new Map<string, Decimal>();
    for (const l of sale.lines) rates.set(l.vatRate.toString(), (rates.get(l.vatRate.toString()) ?? D(0)).plus(l.gross.toString()));
    for (const p of sale.payments) {
      if (p.method === "POINTS") continue;
      for (const [rate, g] of rates) {
        const k = `${sale.registerId}|${cat(p.method)}|${rate}`;
        const cur = sums.get(k) ?? { branchId: sale.register.branchId, till: sale.register.code, category: cat(p.method), vatRate: rate, amount: D(0) };
        cur.amount = cur.amount.plus(D(p.amount.toString()).mul(g).div(gross).mul(sign));
        sums.set(k, cur);
      }
    }
  }
  const by = sales[0]?.cashierId ?? (await prisma.membership.findFirst({ where: { companyId, isOwner: true }, select: { userId: true } }))?.userId;
  const rows = [...sums.values()].map((r) => ({ ...r, amount: r.amount.toDecimalPlaces(2) })).filter((r) => !r.amount.isZero());
  await prisma.$transaction(async (tx) => {
    await tx.accountingEntry.deleteMany({ where: { companyId, date: from, description: { startsWith: "Till sales" } } });
    if (rows.length && by) await tx.accountingEntry.createMany({
      data: rows.map((r) => ({ companyId, branchId: r.branchId, kind: "SALE" as const, category: r.category as never, date: from, amount: r.amount.toFixed(2), vatRate: r.vatRate, description: `Till sales ${day} — ${r.till} — ${r.category === "SALES_CASH" ? "cash" : r.category === "SALES_CARD" ? "card" : "other"}`, createdById: by })),
    });
  });
  return rows.length;
}

/** The nightly run (and on demand): every company that sold at a till in the last `days` days, day by day. */
export async function runDailyTillPosting(now = new Date(), days = 7) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await prisma.posSale.findMany({ where: { soldAt: { gte: since } }, select: { companyId: true, soldAt: true }, distinct: ["companyId", "soldAt"] });
  const todo = new Set(rows.map((r) => `${r.companyId}|${r.soldAt.toISOString().slice(0, 10)}`));
  let posted = 0;
  for (const k of todo) { const [companyId, day] = k.split("|"); posted += await postDailyTillSales(companyId, day); }
  return { days: todo.size, entries: posted };
}

export async function listShifts(ctx: Ctx, registerId?: string) {
  await requirePos(ctx, "sell");
  const a = await tillAccess(ctx.company.id, ctx.user.id);
  return prisma.posShift.findMany({ where: { register: { companyId: ctx.company.id }, registerId: registerId && a.sell.has(registerId) ? registerId : { in: [...a.sell] } }, orderBy: { openedAt: "desc" }, take: 100, include: { register: { select: { code: true, name: true } }, _count: { select: { sales: true } } } });
}

// ── open tables ────────────────────────────────────────────────────────────

export async function listTickets(ctx: Ctx, registerId: string) {
  await requirePos(ctx, "sell");
  await ownRegister(ctx, registerId);
  return prisma.posOpenTicket.findMany({ where: { registerId }, orderBy: { createdAt: "asc" } });
}

export async function saveTicket(ctx: Ctx, i: { id?: string | null; registerId: string; label: string; lines: unknown[]; sentLines?: number }) {
  await requirePos(ctx, "sell");
  await ownRegister(ctx, i.registerId);
  if (!i.label.trim()) throw new ValidationError("Name the table / tab.");
  if (!Array.isArray(i.lines) || i.lines.length > 300) throw new ValidationError("Check the items.");
  const data = { label: i.label.trim().slice(0, 40), lines: i.lines as never, sentLines: Math.max(0, Math.floor(i.sentLines ?? 0)), byUserId: ctx.user.id };
  if (i.id) {
    const own = await prisma.posOpenTicket.findFirst({ where: { id: i.id, register: { companyId: ctx.company.id } } });
    if (!own) throw new NotFoundError();
    return prisma.posOpenTicket.update({ where: { id: i.id }, data });
  }
  return prisma.posOpenTicket.create({ data: { ...data, registerId: i.registerId } });
}

export async function deleteTicket(ctx: Ctx, id: string) {
  await requirePos(ctx, "sell");
  await prisma.posOpenTicket.deleteMany({ where: { id, register: { companyId: ctx.company.id } } });
  return { ok: true };
}

// ── sales, reports ─────────────────────────────────────────────────────────

export async function listSales(ctx: Ctx, f: { from?: Date; to?: Date; registerId?: string; q?: string } = {}) {
  await requirePos(ctx, "sell");
  // each till's manager sees its sales; a cashier sees their own sales on the tills they use
  const a = await tillAccess(ctx.company.id, ctx.user.id);
  const regs = f.registerId ? [f.registerId] : [...a.sell];
  return prisma.posSale.findMany({
    where: {
      companyId: ctx.company.id,
      OR: [{ registerId: { in: regs.filter((r) => a.manage.has(r)) } }, { registerId: { in: regs.filter((r) => a.sell.has(r)) }, cashierId: ctx.user.id }],
      ...(f.from || f.to ? { soldAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
      ...(f.q ? { OR: [{ number: { contains: f.q } }, { fiscalNumber: { contains: f.q } }, { customerTaxId: { contains: f.q } }] } : {}),
    },
    orderBy: { soldAt: "desc" }, take: 300,
    include: { payments: { select: { method: true, amount: true } }, register: { select: { code: true } }, _count: { select: { lines: true } } },
  });
}

export async function saleDetail(ctx: Ctx, id: string) {
  await requirePos(ctx, "sell");
  const s = await prisma.posSale.findUnique({ where: { id }, include: { lines: true, payments: true, register: { select: { code: true, name: true } }, member: { select: { name: true, code: true } }, refunds: { select: { id: true, number: true, gross: true, soldAt: true, lines: { select: { qty: true, lots: true } } } }, refundOf: { select: { id: true, number: true } } } });
  if (!s || s.companyId !== ctx.company.id) throw new NotFoundError();
  const a = await tillAccess(ctx.company.id, ctx.user.id);
  if (!a.manage.has(s.registerId) && !(a.sell.has(s.registerId) && s.cashierId === ctx.user.id)) throw new ForbiddenError();
  return s;
}

/** Sales over a period: totals, by day, item, payment, VAT rate and cashier (refunds taken off). */
export async function salesReport(ctx: Ctx, f: { from: Date; to: Date; registerId?: string }) {
  const access = await requirePos(ctx, "sell");
  // reports of the tills this person manages (the owner / company managers: all)
  const a = await tillAccess(ctx.company.id, ctx.user.id);
  if (!a.manage.size) throw new ForbiddenError("Reports are for the till's managers.");
  const regs = f.registerId && a.manage.has(f.registerId) ? [f.registerId] : [...a.manage];
  const sales = await prisma.posSale.findMany({
    where: { companyId: ctx.company.id, status: "COMPLETED", soldAt: { gte: f.from, lt: f.to }, registerId: { in: regs } },
    include: { payments: true, lines: true },
  });
  const z = zReport(sales.map(toZ), [], 0);
  const byDay = new Map<string, { count: number; gross: number }>();
  const byItem = new Map<string, { name: string; qty: number; gross: number }>();
  for (const s of sales) {
    const sign = s.kind === "REFUND" ? -1 : 1;
    const day = s.soldAt.toISOString().slice(0, 10);
    const d = byDay.get(day) ?? { count: 0, gross: 0 };
    byDay.set(day, { count: d.count + (s.kind === "SALE" ? 1 : 0), gross: Math.round((d.gross + sign * n2(s.gross)) * 100) / 100 });
    for (const l of s.lines) {
      const k = l.itemId ?? `free:${l.name}`;
      const it = byItem.get(k) ?? { name: l.name, qty: 0, gross: 0 };
      byItem.set(k, { name: l.name, qty: Math.round((it.qty + sign * n2(l.qty)) * 1000) / 1000, gross: Math.round((it.gross + sign * n2(l.gross)) * 100) / 100 });
    }
  }
  const names = Object.fromEntries((await cashiers(ctx.company.id)).map((p) => [p.userId, p.name]));
  const tills = await prisma.posRegister.findMany({ where: { id: { in: [...a.manage] } }, select: { id: true, name: true, code: true, branch: { select: { name: true } } }, orderBy: { code: "asc" } });
  const byTill = tills.filter((t) => regs.includes(t.id)).map((t) => {
    const zt = zReport(sales.filter((s) => s.registerId === t.id).map(toZ), [], 0);
    return { id: t.id, name: t.name, code: t.code, shop: t.branch?.name ?? null, count: zt.count, gross: zt.gross, cash: zt.byPayment.CASH ?? 0, card: (zt.byPayment.CARD ?? 0) + (zt.byPayment.MBWAY ?? 0) };
  });
  return {
    currency: access.currency, totals: z, names, byTill, tills: tills.map((t) => ({ id: t.id, label: `${t.code} · ${t.name}${t.branch ? ` (${t.branch.name})` : ""}` })), registerId: f.registerId && a.manage.has(f.registerId) ? f.registerId : null,
    byDay: [...byDay].sort((a, b) => a[0].localeCompare(b[0])).map(([day, v]) => ({ day, ...v })),
    byItem: [...byItem.values()].sort((a, b) => b.gross - a.gross),
    average: z.count ? Math.round((z.salesGross / z.count) * 100) / 100 : 0,
  };
}

// ── a restaurant's ingredient stock ────────────────────────────────────────

/** Each ingredient a recipe uses: packs left from FIRINGI purchases, used per day lately, days left and what to reorder. */
export async function ingredientStock(ctx: Ctx, locale = "en", days = 14) {
  await requirePos(ctx, "manage");
  const lines = await prisma.posRecipeLine.findMany({ where: { item: { companyId: ctx.company.id, active: true } }, include: { item: { select: { id: true, name: true } } } });
  const offerIds = [...new Set(lines.map((l) => l.offerId))];
  if (!offerIds.length) return [];
  const since = new Date(Date.now() - days * 86_400_000);
  const sold = await prisma.posSaleLine.groupBy({ by: ["itemId"], where: { itemId: { in: [...new Set(lines.map((l) => l.itemId))] }, sale: { companyId: ctx.company.id, status: "COMPLETED", kind: "SALE", soldAt: { gte: since } } }, _sum: { qty: true } });
  const soldQty = new Map(sold.map((s) => [s.itemId, n2(s._sum.qty)]));
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: offerIds } }, include: { packaging: { include: { variant: { include: { product: { select: { name: true } } } } } } } });
  const lots = await prisma.purchasedLot.findMany({ where: { buyerCompanyId: ctx.company.id, offerId: { in: offerIds } }, select: { offerId: true, qty: true, usedQty: true, expiresOn: true, ownBatchId: true } });
  return offers.map((o) => {
    const pack = { netWeightKg: o.packaging.netWeightKg?.toString() ?? null, unitsPerPack: o.packaging.unitsPerPack };
    const used = lines.filter((l) => l.offerId === o.id).reduce((a, l) => a.plus(packsOf(D(l.qty).mul(soldQty.get(l.itemId) ?? 0).toString(), l.unit, pack)), D(0));
    const mine = lots.filter((l) => l.offerId === o.id);
    const left = mine.reduce((a, l) => a + Math.max(0, l.qty - l.usedQty), 0);
    const perDay = used.div(days).toNumber();
    const h = reorderHint(left, perDay, 7);
    const next = mine.filter((l) => l.qty - l.usedQty > 0 && l.expiresOn).map((l) => l.expiresOn!).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    return {
      offerId: o.id, active: o.status === "ACTIVE",
      name: `${pickLocalized(o.packaging.variant.product.name as never, locale)} — ${pickLocalized(o.packaging.name as never, locale)}`,
      dishes: [...new Set(lines.filter((l) => l.offerId === o.id).map((l) => l.item.name))],
      left, usedPerDay: Math.round(perDay * 100) / 100, daysLeft: h.daysLeft, suggest: h.suggest, nextExpiry: next?.toISOString().slice(0, 10) ?? null,
    };
  }).sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
}

// ── the till's snapshot ─────────────────────────────────────────────────────

/** Everything a till needs to keep selling without internet. */
export async function tillSnapshot(ctx: Ctx, registerId?: string | null) {
  const access = await requirePos(ctx, "sell");
  // only the tills this person may use (each shop / warehouse its own people)
  const a = await tillAccess(ctx.company.id, ctx.user.id);
  const registers = (await prisma.posRegister.findMany({ where: { companyId: ctx.company.id, active: true }, orderBy: { code: "asc" } })).filter((r) => a.sell.has(r.id));
  const register = registers.find((r) => r.id === registerId) ?? registers[0] ?? null;
  const [shift, items, members, pins, people, co, tickets] = await Promise.all([
    register ? prisma.posShift.findFirst({ where: { registerId: register.id, status: "OPEN" } }) : null,
    prisma.posItem.findMany({ where: { companyId: ctx.company.id, active: true }, orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, category: true, barcode: true, plu: true, price: true, vatRate: true, byWeight: true, restriction: true, allergens: true, color: true, quick: true, kitchen: true, registerIds: true } }),
    access.company?.loyaltyOn && access.settings.features.loyalty ? prisma.posMember.findMany({ where: { companyId: ctx.company.id }, select: { id: true, code: true, name: true, phone: true, points: true }, take: 3000, orderBy: { createdAt: "desc" } }) : [],
    prisma.posPin.findMany({ where: { companyId: ctx.company.id } }),
    cashiers(ctx.company.id),
    prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { legalName: true, tradeName: true, taxId: true, vatNumber: true, addresses: { where: { isActive: true }, take: 1, orderBy: { createdAt: "asc" }, select: { line1: true, cityName: true, postalCode: true } } } }),
    register && access.settings.features.tables ? prisma.posOpenTicket.findMany({ where: { registerId: register.id }, orderBy: { createdAt: "asc" } }) : [],
  ]);
  const sold = shift ? await prisma.posSale.count({ where: { shiftId: shift.id } }) : 0;
  const pc = access.company;
  // a PIN approves on this till only when its person manages this till
  const pinRows = [];
  for (const p of pins) {
    const name = people.find((x) => x.userId === p.userId)?.name;
    if (!name) continue;
    pinRows.push({ userId: p.userId, hash: p.pinHash, name, manager: !!register && (await tillAccess(ctx.company.id, p.userId)).manage.has(register.id) });
  }
  return {
    at: new Date().toISOString(),
    company: { id: ctx.company.id, name: co.tradeName ?? co.legalName, legalName: co.legalName, taxId: co.taxId, vatId: co.vatNumber, address: co.addresses[0] ? `${co.addresses[0].line1}, ${co.addresses[0].postalCode} ${co.addresses[0].cityName}`.replace(/\s+/g, " ").trim() : "", countryCode: access.countryCode },
    user: { id: ctx.user.id, name: ctx.user.name, manager: !!register && a.manage.has(register.id) },
    registers: registers.map((r) => ({ id: r.id, name: r.name, code: r.code })),
    register: register ? { id: register.id, name: register.name, code: register.code } : null,
    shift: shift ? { id: shift.id, number: shift.number, openedAt: shift.openedAt.toISOString(), openingFloat: n2(shift.openingFloat), sold } : null,
    items: items.filter((i) => !i.registerIds.length || (!!register && i.registerIds.includes(register.id))).map(({ registerIds: _r, ...i }) => ({ ...i, price: n2(i.price), vatRate: n2(i.vatRate) })),
    members, tickets: tickets.map((t) => ({ id: t.id, label: t.label, lines: t.lines, sentLines: t.sentLines, updatedAt: t.updatedAt.toISOString() })),
    pins: pinRows,
    settings: {
      currency: access.currency, decimals: access.decimals, features: access.settings.features, offlineHours: access.settings.offlineHours, offlineMaxSales: access.settings.offlineMaxSales,
      stage: access.stage, countryStage: access.countryStage, provider: access.provider, blocked: access.blocked,
      discountLimit: n2(pc?.discountLimit ?? 10), refundDays: pc?.refundDays ?? 30, loyaltyOn: !!pc?.loyaltyOn && access.settings.features.loyalty, pointsPerUnit: n2(pc?.pointsPerUnit ?? 1), pointValue: n2(pc?.pointValue ?? 0.01), minRedeem: pc?.minRedeem ?? 100,
      receiptHeader: pc?.receiptHeader ?? null, receiptFooter: pc?.receiptFooter ?? null, emailReceipts: pc?.emailReceipts ?? true,
      scale: { prefixes: ["28", "29"], itemDigits: 5, valueDigits: 5 },
    },
  };
}
export type TillSnapshot = Awaited<ReturnType<typeof tillSnapshot>>;

/** The till's start page: today's numbers, open shifts, receipts waiting for the provider. */
export async function posOverview(ctx: Ctx) {
  const access = await requirePos(ctx, "sell");
  const a = await tillAccess(ctx.company.id, ctx.user.id);
  const mine = { in: [...a.sell] };
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [today, registers, pending, failed, items] = await Promise.all([
    prisma.posSale.findMany({ where: { companyId: ctx.company.id, status: "COMPLETED", soldAt: { gte: start }, registerId: { in: [...a.manage] } }, select: { kind: true, gross: true } }),
    prisma.posRegister.findMany({ where: { companyId: ctx.company.id, id: mine }, orderBy: { code: "asc" }, include: { shifts: { where: { status: "OPEN" }, select: { id: true, number: true, openedAt: true } } } }),
    prisma.posSale.count({ where: { companyId: ctx.company.id, fiscalStatus: "PENDING", registerId: mine } }),
    prisma.posSale.count({ where: { companyId: ctx.company.id, fiscalStatus: "FAILED", registerId: mine } }),
    prisma.posItem.count({ where: { companyId: ctx.company.id, active: true } }),
  ]);
  const gross = today.reduce((a, s) => a + (s.kind === "REFUND" ? -1 : 1) * n2(s.gross), 0);
  const count = today.filter((s) => s.kind === "SALE").length;
  return { access: { ...access, company: undefined }, today: { count, gross: Math.round(gross * 100) / 100, average: count ? Math.round((gross / count) * 100) / 100 : 0 }, registers, pending, failed, items, manage: can(ctx, "company.pos.manage") && a.companyManage, managesTills: a.manage.size > 0 };
}

// ── FIRINGI admin ──────────────────────────────────────────────────────────

function requireAdmin(ctx: Ctx, manage = false) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, manage ? "admin.settings.manage" : ["admin.settings.manage", "admin.vendors.view", "admin.customers.view", "admin.finance.view"])) throw new ForbiddenError();
}

export async function adminPosOverview(ctx: Ctx) {
  requireAdmin(ctx);
  const s = await posSettings();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [companies, rows, registers, sales, pending, failed] = await Promise.all([
    prisma.company.findMany({ where: { type: { in: ["DISTRIBUTOR", "WHOLESALER", "CUSTOMER"] }, status: "APPROVED" }, select: { id: true, type: true, country: { select: { code: true } } } }),
    prisma.posCompany.findMany({ select: { companyId: true, adminState: true, fiscalProvider: true } }),
    prisma.posRegister.groupBy({ by: ["companyId"], _count: { _all: true } }),
    prisma.posSale.groupBy({ by: ["companyId"], where: { soldAt: { gte: since }, status: "COMPLETED", kind: "SALE" }, _count: { _all: true } }),
    prisma.posSale.count({ where: { fiscalStatus: "PENDING" } }),
    prisma.posSale.count({ where: { fiscalStatus: "FAILED" } }),
  ]);
  const tillRequests = await prisma.posRegister.count({ where: { approval: "PENDING" } });
  const state = new Map(rows.map((r) => [r.companyId, r]));
  const byType: Record<string, { allowed: number; using: number; total: number }> = {};
  const using = new Set(sales.map((x) => x.companyId));
  for (const c of companies) {
    const b = byType[c.type] ?? { allowed: 0, using: 0, total: 0 };
    b.total++;
    if (posAllowed(s, { type: c.type, countryCode: c.country.code, adminState: state.get(c.id)?.adminState }).on) b.allowed++;
    if (using.has(c.id)) b.using++;
    byType[c.type] = b;
  }
  return { settings: s, byType, tillRequests, registers: registers.reduce((a, r) => a + r._count._all, 0), sales30: sales.reduce((a, x) => a + x._count._all, 0), pending, failed, connected: rows.filter((r) => r.fiscalProvider).length };
}

export async function adminPosCompanies(ctx: Ctx, f: { type?: string; q?: string } = {}) {
  requireAdmin(ctx);
  const s = await posSettings();
  const cos = await prisma.company.findMany({
    where: { type: { in: f.type && ["DISTRIBUTOR", "WHOLESALER", "CUSTOMER"].includes(f.type) ? [f.type as never] : ["DISTRIBUTOR", "WHOLESALER", "CUSTOMER"] }, status: "APPROVED", ...(f.q ? { OR: [{ legalName: { contains: f.q, mode: "insensitive" } }, { tradeName: { contains: f.q, mode: "insensitive" } }] } : {}) },
    select: { id: true, legalName: true, tradeName: true, type: true, country: { select: { code: true } }, posCompany: { select: { adminState: true, fiscalProvider: true, fiscalTestOk: true } }, _count: { select: { posRegisters: true } } },
    orderBy: { legalName: "asc" }, take: 500,
  });
  const since = new Date(Date.now() - 30 * 86_400_000);
  const sales = await prisma.posSale.groupBy({ by: ["companyId"], where: { companyId: { in: cos.map((c) => c.id) }, soldAt: { gte: since }, kind: "SALE", status: "COMPLETED" }, _count: { _all: true } });
  const count = new Map(sales.map((x) => [x.companyId, x._count._all]));
  return cos.map((c) => {
    const st = c.posCompany?.adminState ?? "DEFAULT";
    const eff = posAllowed(s, { type: c.type, countryCode: c.country.code, adminState: st });
    return { id: c.id, name: c.tradeName ?? c.legalName, type: c.type, country: c.country.code, adminState: st, on: eff.on, reason: eff.reason, registers: c._count.posRegisters, sales30: count.get(c.id) ?? 0, provider: c.posCompany?.fiscalProvider ?? null, providerOk: c.posCompany?.fiscalTestOk ?? null };
  });
}

/** FIRINGI's own switch for one company: follow its type's switch, always on, or off. */
export async function setPosCompanyState(ctx: Ctx, companyId: string, state: "DEFAULT" | "ON" | "OFF") {
  requireAdmin(ctx, true);
  if (!["DEFAULT", "ON", "OFF"].includes(state)) throw new ValidationError("Choose default, on or off.");
  const co = await prisma.company.findUnique({ where: { id: companyId }, select: { type: true } });
  if (!co || co.type === "ADMIN") throw new NotFoundError();
  const before = await prisma.posCompany.findUnique({ where: { companyId }, select: { adminState: true } });
  await prisma.posCompany.upsert({ where: { companyId }, update: { adminState: state }, create: { companyId, adminState: state } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pos.company.state", entityType: "Company", entityId: companyId, before: { adminState: before?.adminState ?? "DEFAULT" }, after: { adminState: state } });
  return posAccess(companyId).then((a) => ({ on: a.on, reason: a.reason }));
}

/** Extra tills waiting for FIRINGI's approval (and the latest decisions). */
export async function adminTillRequests(ctx: Ctx) {
  requireAdmin(ctx);
  return prisma.posRegister.findMany({
    where: { OR: [{ approval: "PENDING" }, { decidedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }] }, orderBy: [{ approval: "asc" }, { createdAt: "desc" }], take: 200,
    select: { id: true, name: true, code: true, approval: true, createdAt: true, decidedAt: true, decisionNote: true, company: { select: { id: true, legalName: true, type: true, country: { select: { code: true } }, _count: { select: { posRegisters: true } } } } },
  });
}

export async function decideTill(ctx: Ctx, registerId: string, approve: boolean, note?: string | null) {
  requireAdmin(ctx, true);
  const r = await prisma.posRegister.findUnique({ where: { id: registerId } });
  if (!r) throw new NotFoundError();
  if (r.approval !== "PENDING") throw new ValidationError("This till was already decided.");
  if (!approve && !(note ?? "").trim()) throw new ValidationError("Give the business a reason.");
  const d = await prisma.posRegister.update({ where: { id: r.id }, data: { approval: approve ? "APPROVED" : "REJECTED", active: approve ? r.active : false, decidedById: ctx.user.id, decidedAt: new Date(), decisionNote: clean(note, 300) } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: approve ? "pos.till.approve" : "pos.till.reject", entityType: "PosRegister", entityId: r.id, after: { note } });
  const { notify } = await import("@/server/notify/dispatch");
  await notify("pos.till_decided", [{ companyId: r.companyId }], { till: `${r.name} (${r.code})`, decision: approve ? "approved" : "refused", note: note ?? "" }, { ref: { type: "PosRegister", id: r.id } }).catch(() => null);
  return d;
}

export async function adminFiscalQueue(ctx: Ctx) {
  requireAdmin(ctx);
  return prisma.posSale.findMany({
    where: { fiscalStatus: { in: ["PENDING", "FAILED"] } }, orderBy: { createdAt: "desc" }, take: 200,
    select: { id: true, number: true, gross: true, currency: true, soldAt: true, fiscalStatus: true, fiscalProvider: true, fiscalAttempts: true, fiscalError: true, fiscalNextAt: true, companyId: true, register: { select: { company: { select: { legalName: true, country: { select: { code: true } } } } } } },
  });
}

/** A supplier's own products to link a till item to (its stock). */
export async function ownOffers(ctx: Ctx, locale = "en") {
  await requirePos(ctx, "manage");
  const offers = await prisma.vendorOffer.findMany({ where: { vendorCompanyId: ctx.company.id, status: "ACTIVE" }, take: 500, select: { id: true, vendorSku: true, packaging: { select: { name: true, variant: { select: { sku: true, product: { select: { name: true } } } } } } } });
  return offers.map((o) => ({ id: o.id, name: `${pickLocalized(o.packaging.variant.product.name as never, locale)} · ${pickLocalized(o.packaging.name as never, locale)} (${o.vendorSku ?? o.packaging.variant.sku})` }));
}

/** The tills with an open shift (where a refund can be given), with the shift's receipt count. */
export async function openRegisters(ctx: Ctx) {
  await requirePos(ctx, "sell");
  const a = await tillAccess(ctx.company.id, ctx.user.id);
  const regs = await prisma.posRegister.findMany({ where: { companyId: ctx.company.id, active: true, id: { in: [...a.sell] } }, orderBy: { code: "asc" }, include: { shifts: { where: { status: "OPEN" }, select: { id: true, number: true, _count: { select: { sales: true } } } } } });
  return regs.map((r) => ({ id: r.id, name: r.name, shiftId: r.shifts[0]?.id ?? null, shiftNumber: r.shifts[0]?.number ?? null, sold: r.shifts[0]?._count.sales ?? 0 }));
}
