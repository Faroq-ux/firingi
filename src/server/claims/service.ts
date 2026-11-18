/**
 * Quality claims (Phase 31).
 *
 *   customer reports a problem with delivered goods (lines, quantities, reason, photos) within the
 *   claim window → the supplier may give its side → FIRINGI (merchant of record) decides within the
 *   SLA: credit note (certified through the invoicing provider), replacement, or rejection — and whose
 *   fault it was.
 *
 * Who pays:
 *   SUPPLIER fault → the credit goes on a CREDIT billing statement (the supplier credits FIRINGI; it is
 *     netted off its payout). The supplier's own drivers are its own staff, so delivery faults on the
 *     supplier's fleet are the supplier's too.
 *   DRIVER fault  → FIRINGI carries the credit; a charge-back to the FIRINGI driver is only possible on
 *     a delivery the customer paid a delivery fee / flat rate for (the only deliveries that earn
 *     per-delivery pay), capped at that pay.
 *   FIRINGI fault (goodwill) → FIRINGI carries it.
 *
 * Privacy: customers never see supplier costs or FIRINGI's margin; suppliers never see sale prices.
 */
import "server-only";
import { Prisma, type ClaimFault, type ClaimOutcome, type ClaimReason, type ClaimStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { creditInvoice } from "@/server/invoicing/service";
import { storeUpload } from "@/server/services/storage";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pick = (v: unknown) => { const o = (v ?? {}) as Record<string, string>; return o.pt ?? o.en ?? Object.values(o)[0] ?? ""; };

export const CLAIM_REASONS: ClaimReason[] = ["DAMAGED", "MISSING", "WRONG_PRODUCT", "TEMPERATURE", "SHORT_DATED", "QUALITY"];

// ── settings ────────────────────────────────────────────────────────────────

export type ClaimSettings = {
  windowHours: number; // the customer can claim this long after delivery
  slaHours: number; // FIRINGI decides within
  supplierResponseHours: number; // the supplier's side is asked for within
  photoReasons: ClaimReason[]; // reasons that need at least one photo
  supplierRatePct: number; // alert: upheld claims per delivered order, per supplier (30 days)
  productRatePct: number; // alert: claimed units per delivered unit, per product (30 days)
  lotClaims: number; // alert: claims naming the same lot (30 days)
  driverClaims: number; // alert: upheld driver-fault claims per FIRINGI driver (30 days)
  minDeliveries: number; // rates need at least this many delivered orders / units
};
export const DEFAULT_CLAIM_SETTINGS: ClaimSettings = {
  windowHours: 48, slaHours: 48, supplierResponseHours: 24, photoReasons: ["DAMAGED", "TEMPERATURE", "QUALITY", "WRONG_PRODUCT", "SHORT_DATED"],
  supplierRatePct: 3, productRatePct: 5, lotClaims: 3, driverClaims: 3, minDeliveries: 10,
};
const SETTINGS_KEY = "claims.settings";

export async function claimSettings(): Promise<ClaimSettings> {
  const s = await prisma.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: SETTINGS_KEY } } });
  return { ...DEFAULT_CLAIM_SETTINGS, ...((s?.value ?? {}) as Partial<ClaimSettings>) };
}

const assertAdmin = (ctx: Ctx, manage = false) => {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  if (!can(ctx, manage ? "admin.claims.manage" : ["admin.claims.manage", "admin.orders.view", "admin.orders.manage"])) throw new ForbiddenError();
};

export async function saveClaimSettings(ctx: Ctx, patch: Partial<ClaimSettings>) {
  assertAdmin(ctx, true);
  const before = await claimSettings();
  const n = { ...before, ...patch };
  const int = (v: number, lo: number, hi: number, label: string) => { if (!Number.isFinite(v) || v < lo || v > hi) throw new ValidationError(`${label} must be between ${lo} and ${hi}.`); return Math.round(v); };
  const pct = (v: number, label: string) => { if (!Number.isFinite(v) || v <= 0 || v > 100) throw new ValidationError(`${label} must be between 0 and 100 %.`); return Math.round(v * 10) / 10; };
  const out: ClaimSettings = {
    windowHours: int(n.windowHours, 1, 24 * 30, "Claim window (hours)"), slaHours: int(n.slaHours, 1, 24 * 14, "Decision time (hours)"),
    supplierResponseHours: int(n.supplierResponseHours, 1, 24 * 7, "Supplier answer time (hours)"),
    photoReasons: (n.photoReasons ?? []).filter((r) => CLAIM_REASONS.includes(r)),
    supplierRatePct: pct(n.supplierRatePct, "Supplier claim rate"), productRatePct: pct(n.productRatePct, "Product claim rate"),
    lotClaims: int(n.lotClaims, 1, 100, "Claims per lot"), driverClaims: int(n.driverClaims, 1, 100, "Claims per driver"), minDeliveries: int(n.minDeliveries, 1, 10000, "Minimum deliveries"),
  };
  await prisma.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: SETTINGS_KEY } }, update: { value: out }, create: { scope: "GLOBAL", key: SETTINGS_KEY, value: out } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "claims.settings_changed", entityType: "Setting", entityId: SETTINGS_KEY, before, after: out });
  return out;
}

// ── what can be claimed ─────────────────────────────────────────────────────

const OPEN_OR_UPHELD: ClaimStatus[] = ["OPEN", "APPROVED"];

async function buyerOrder(ctx: Ctx, orderId: string) {
  if (!can(ctx, ["buyer.claims.manage", "buyer.orders.view"])) throw new ForbiddenError();
  const order = await prisma.order.findFirst({ where: { id: orderId, buyerCompanyId: ctx.company.id } });
  if (!order) throw new NotFoundError("Order");
  const { branchScope } = await import("@/server/multisite/branches");
  const scope = await branchScope(ctx);
  if (scope && !(order.branchId && scope.includes(order.branchId))) throw new NotFoundError("Order");
  return order;
}

/** Lines of a delivered order with what can still be claimed, the lots delivered and the deadline. */
export async function claimableOrder(ctx: Ctx, orderId: string) {
  await buyerOrder(ctx, orderId);
  const s = await claimSettings();
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      id: true, number: true, status: true, seller: { select: { legalName: true, tradeName: true } },
      lines: { select: { id: true, offerId: true, sku: true, productName: true, packagingName: true, qtyDelivered: true } },
      claims: { where: { status: { in: OPEN_OR_UPHELD } }, select: { status: true, lines: { select: { orderLineId: true, qty: true, approvedQty: true } } } },
      returns: { where: { status: { not: "REJECTED" } }, select: { lines: { select: { orderLineId: true, qty: true } } } },
      delivery: { select: { completedAt: true } },
      statusHistory: { where: { toStatus: "DELIVERED" }, orderBy: { at: "desc" }, take: 1, select: { at: true } },
      purchasedLots: { select: { offerId: true, lotCode: true, expiresOn: true, qty: true } },
    },
  });
  const taken = new Map<string, number>();
  for (const c of order.claims) for (const l of c.lines) taken.set(l.orderLineId, (taken.get(l.orderLineId) ?? 0) + (c.status === "APPROVED" ? l.approvedQty ?? 0 : l.qty));
  for (const r of order.returns) for (const l of r.lines) taken.set(l.orderLineId, (taken.get(l.orderLineId) ?? 0) + l.qty);
  const deliveredAt = order.delivery?.completedAt ?? order.statusHistory[0]?.at ?? null;
  const deadline = deliveredAt ? new Date(deliveredAt.getTime() + s.windowHours * HOUR) : null;
  const open = order.status === "DELIVERED" && !!deadline && Date.now() <= deadline.getTime();
  return {
    id: order.id, number: order.number, supplier: order.seller.tradeName ?? order.seller.legalName, open, deliveredAt, deadline, windowHours: s.windowHours, photoReasons: s.photoReasons,
    lines: order.lines.map((l) => ({
      id: l.id, sku: l.sku, product: pick(l.productName), packaging: pick(l.packagingName), delivered: l.qtyDelivered ?? 0,
      claimable: Math.max(0, (l.qtyDelivered ?? 0) - (taken.get(l.id) ?? 0)),
      lots: order.purchasedLots.filter((p) => p.offerId === l.offerId).map((p) => ({ lotCode: p.lotCode, expiresOn: p.expiresOn.toISOString().slice(0, 10), qty: p.qty })),
    })),
  };
}

async function nextNumber(tx: Prisma.TransactionClient) {
  const year = new Date().getFullYear();
  const seq = await tx.$queryRaw<{ n: number }[]>`INSERT INTO "Sequence" (name, year, "nextValue") VALUES ('claim', ${year}, 2)
    ON CONFLICT (name, year) DO UPDATE SET "nextValue" = "Sequence"."nextValue" + 1 RETURNING "nextValue" - 1 AS n`;
  return `CL-${year}-${String(seq[0].n).padStart(6, "0")}`;
}

async function storePhotos(files: File[] | undefined, max = 6) {
  const keys: string[] = [];
  for (const f of (files ?? []).filter((x) => x && x.size > 0).slice(0, max)) {
    const s = await storeUpload(f, "claims");
    if (!s.mimeType.startsWith("image/")) throw new ValidationError("Photos must be images (JPG, PNG or WEBP).");
    keys.push(s.key);
  }
  return keys;
}

const adminCompanyId = async () => (await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } }))?.id ?? null;

export type NewClaim = { reason: ClaimReason; description: string; preferredOutcome: ClaimOutcome; lines: { orderLineId: string; qty: number; lotCode?: string | null }[]; photos?: File[] };

export async function createClaim(ctx: Ctx, orderId: string, input: NewClaim) {
  if (!can(ctx, "buyer.claims.manage")) throw new ForbiddenError();
  const order = await buyerOrder(ctx, orderId);
  const c = await claimableOrder(ctx, orderId);
  if (!c.open) throw new AppError("CLAIM_CLOSED", `Problems can be reported up to ${c.windowHours} hours after delivery.`, 409, { hours: String(c.windowHours) });
  if (!CLAIM_REASONS.includes(input.reason)) throw new ValidationError("Choose what is wrong.");
  const description = input.description.trim();
  if (description.length < 5) throw new ValidationError("Describe the problem.");
  if (input.preferredOutcome !== "CREDIT" && input.preferredOutcome !== "REPLACEMENT") throw new ValidationError("Choose credit or replacement.");
  const wanted = input.lines.filter((l) => l.qty > 0);
  if (!wanted.length) throw new ValidationError("Choose at least one product and quantity.");
  for (const w of wanted) {
    const l = c.lines.find((x) => x.id === w.orderLineId);
    if (!l || !Number.isInteger(w.qty) || w.qty > l.claimable) throw new ValidationError("You can't claim more than was delivered (minus earlier claims and returns).");
    if (w.lotCode && !l.lots.some((x) => x.lotCode === w.lotCode)) throw new ValidationError("Choose a lot that was delivered with this product.");
  }
  const s = await claimSettings();
  const photoKeys = await storePhotos(input.photos);
  if (s.photoReasons.includes(input.reason) && !photoKeys.length) throw new ValidationError("Add at least one photo of the problem.");
  const lineInfo = await prisma.orderLine.findMany({ where: { id: { in: wanted.map((w) => w.orderLineId) } }, select: { id: true, offerId: true } });
  const created = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx);
    const cl = await tx.qualityClaim.create({
      data: {
        number, orderId, buyerCompanyId: ctx.company.id, sellerCompanyId: order.sellerCompanyId, reason: input.reason, description, photoKeys, preferredOutcome: input.preferredOutcome,
        dueBy: new Date(Date.now() + s.slaHours * HOUR), createdById: ctx.user.id,
        lines: { create: wanted.map((w) => {
          const l = c.lines.find((x) => x.id === w.orderLineId)!;
          return { orderLineId: w.orderLineId, offerId: lineInfo.find((x) => x.id === w.orderLineId)!.offerId, qty: w.qty, lotCode: w.lotCode || (l.lots.length === 1 ? l.lots[0].lotCode : null) };
        }) },
      },
    });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "claim.opened", entityType: "QualityClaim", entityId: cl.id, after: { number, orderId, reason: input.reason, lines: wanted } }, tx);
    return cl;
  });
  const admin = await adminCompanyId();
  await notify("claim.opened", [...(admin ? [{ companyId: admin, link: `/admin/orders/claims/${created.id}` }] : []), { companyId: order.sellerCompanyId, link: `/vendor/orders/claims/${created.id}` }],
    { number: created.number, order: order.number, reason: input.reason }, { ref: { type: "QualityClaim", id: created.id } });
  return created;
}

// ── lists & detail ──────────────────────────────────────────────────────────

export type ClaimView = "BUYER" | "VENDOR" | "ADMIN";

const listInclude = {
  order: { select: { id: true, number: true, deliveryMode: true } },
  buyer: { select: { id: true, legalName: true, tradeName: true } },
  seller: { select: { id: true, legalName: true, tradeName: true } },
  lines: { select: { qty: true, approvedQty: true, orderLine: { select: { productName: true } } } },
} satisfies Prisma.QualityClaimInclude;

export async function listClaims(ctx: Ctx, as: ClaimView, f: { status?: ClaimStatus | "OVERDUE"; reason?: ClaimReason; sellerId?: string } = {}) {
  const where: Prisma.QualityClaimWhereInput = {};
  if (f.status === "OVERDUE") Object.assign(where, { status: "OPEN", dueBy: { lt: new Date() } });
  else if (f.status) where.status = f.status;
  if (f.reason) where.reason = f.reason;
  if (as === "BUYER") {
    if (!can(ctx, ["buyer.claims.manage", "buyer.orders.view"])) throw new ForbiddenError();
    where.buyerCompanyId = ctx.company.id;
    const { branchScope } = await import("@/server/multisite/branches");
    const scope = await branchScope(ctx);
    if (scope) where.order = { branchId: { in: scope } };
  } else if (as === "VENDOR") {
    if (!can(ctx, ["vendor.claims.respond", "vendor.orders.view"])) throw new ForbiddenError();
    where.sellerCompanyId = ctx.company.id;
  } else {
    assertAdmin(ctx);
    if (f.sellerId) where.sellerCompanyId = f.sellerId;
  }
  const rows = await prisma.qualityClaim.findMany({ where, include: listInclude, orderBy: [{ status: "asc" }, { dueBy: "asc" }], take: 300 });
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id, number: r.number, orderId: r.order.id, orderNumber: r.order.number, reason: r.reason, status: r.status, outcome: r.outcome, fault: as === "ADMIN" ? r.fault : null,
    preferredOutcome: r.preferredOutcome, buyer: r.buyer.tradeName ?? r.buyer.legalName, seller: r.seller.tradeName ?? r.seller.legalName,
    products: [...new Set(r.lines.map((l) => pick(l.orderLine.productName)))].join(", "), units: r.lines.reduce((a, l) => a + l.qty, 0),
    createdAt: r.createdAt, dueBy: r.dueBy, overdue: r.status === "OPEN" && r.dueBy.getTime() < now,
    supplierResponse: r.supplierResponse, credit: as === "VENDOR" ? null : r.creditGross === null ? null : Number(r.creditGross),
    replacementPending: r.outcome === "REPLACEMENT" && r.status === "APPROVED" && !r.replacementDoneAt,
  }));
}

async function loadClaim(ctx: Ctx, id: string) {
  const c = await prisma.qualityClaim.findUnique({ where: { id }, select: { id: true, buyerCompanyId: true, sellerCompanyId: true, order: { select: { branchId: true } } } });
  if (!c) throw new NotFoundError("Claim");
  if (ctx.company.type === "ADMIN" && can(ctx, ["admin.claims.manage", "admin.orders.view", "admin.orders.manage"])) return { claimId: c.id, as: "ADMIN" as const };
  if (c.sellerCompanyId === ctx.company.id && can(ctx, ["vendor.claims.respond", "vendor.orders.view"])) return { claimId: c.id, as: "VENDOR" as const };
  if (c.buyerCompanyId === ctx.company.id && can(ctx, ["buyer.claims.manage", "buyer.orders.view"])) {
    const { branchScope } = await import("@/server/multisite/branches");
    const scope = await branchScope(ctx);
    if (!scope || (c.order.branchId && scope.includes(c.order.branchId))) return { claimId: c.id, as: "BUYER" as const };
  }
  throw new NotFoundError("Claim");
}

/** The FIRINGI delivery behind an order, and whether a driver charge-back is possible. */
async function deliveryFacts(orderId: string) {
  const { routingSettings } = await import("@/server/services/routes");
  const [o, settings] = await Promise.all([
    prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { deliveryMode: true, deliveryFeeNet: true, delivery: { select: { id: true, completedAt: true, driverId: true, executor: { select: { type: true, legalName: true, tradeName: true } }, driver: { select: { id: true, user: { select: { name: true } }, owner: { select: { type: true } } } } } } },
    }),
    routingSettings(),
  ]);
  const d = o.delivery;
  const firingiFleet = o.deliveryMode === "FIRINGI_FLEET" && d?.executor.type === "ADMIN";
  const feePaid = Number(o.deliveryFeeNet) > 0;
  const firingiDriver = !!d?.driver && d.driver.owner.type === "ADMIN";
  const eligible = firingiFleet && firingiDriver && feePaid;
  return {
    mode: o.deliveryMode, fee: Number(o.deliveryFeeNet), feePaid, firingiFleet, executor: d ? d.executor.tradeName ?? d.executor.legalName : null,
    driverId: firingiDriver ? d!.driver!.id : null, driverName: d?.driver?.user.name ?? null, completedAt: d?.completedAt ?? null,
    driverChargeback: { eligible, cap: eligible ? settings.pay.perDelivery : 0,
      why: !firingiFleet ? "SUPPLIER_FLEET" : !firingiDriver ? "NO_FIRINGI_DRIVER" : !feePaid ? "FREE_DELIVERY" : null },
  };
}

/** Per claimed line: what one unit costs the buyer (gross, from FIRINGI's invoice). */
async function invoiceFacts(orderId: string) {
  const inv = await prisma.invoice.findFirst({ where: { orderId, docType: "INVOICE", status: { not: "DRAFT" } }, include: { lines: true } });
  if (!inv) return null;
  const unit = new Map(inv.lines.filter((l) => l.orderLineId).map((l) => [l.orderLineId!, { lineId: l.id, gross: (Number(l.lineNet) + Number(l.lineVat)) / Math.max(1, Number(l.qty)) }]));
  const fee = inv.lines.find((l) => !l.orderLineId);
  return { id: inv.id, number: inv.fullNumber, unit, feeLine: fee ? { lineId: fee.id, gross: Number(fee.lineNet) + Number(fee.lineVat) } : null };
}

export async function claimDetail(ctx: Ctx, id: string) {
  const { as } = await loadClaim(ctx, id);
  const c = await prisma.qualityClaim.findUniqueOrThrow({
    where: { id },
    include: {
      order: { select: { id: true, number: true, placedAt: true, deliveryMode: true } },
      buyer: { select: { id: true, legalName: true, tradeName: true } },
      seller: { select: { id: true, legalName: true, tradeName: true, type: true } },
      lines: { include: { orderLine: { select: { id: true, sku: true, productName: true, packagingName: true, qtyDelivered: true, vendorUnitCostNet: true } } } },
      messages: { orderBy: { createdAt: "asc" } },
      chargebacks: { include: { driver: { select: { user: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } },
    },
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set([c.createdById, c.decidedById, c.supplierRespondedBy, ...c.messages.map((m) => m.authorUserId)].filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const name = (uid: string | null) => (uid ? users.find((u) => u.id === uid)?.name ?? "—" : null);
  const companyType = new Map((await prisma.company.findMany({ where: { id: { in: [...new Set(c.messages.map((m) => m.authorCompanyId))] } }, select: { id: true, type: true } })).map((x) => [x.id, x.type]));
  const inv = as === "VENDOR" ? null : await invoiceFacts(c.orderId);
  const delivery = as === "ADMIN" ? await deliveryFacts(c.orderId) : null;
  const settings = await claimSettings();
  const vendorCost = (l: (typeof c.lines)[number]) => Number(l.orderLine.vendorUnitCostNet);
  return {
    as, id: c.id, number: c.number, status: c.status, reason: c.reason, description: c.description, photos: c.photoKeys.length, preferredOutcome: c.preferredOutcome,
    createdAt: c.createdAt, createdBy: name(c.createdById), dueBy: c.dueBy, overdue: c.status === "OPEN" && c.dueBy.getTime() < Date.now(),
    supplierAnswerBy: new Date(c.createdAt.getTime() + settings.supplierResponseHours * HOUR),
    order: c.order, buyer: { id: c.buyer.id, name: c.buyer.tradeName ?? c.buyer.legalName }, seller: { id: c.seller.id, name: c.seller.tradeName ?? c.seller.legalName },
    supplier: { response: c.supplierResponse, comment: c.supplierComment, photos: c.supplierPhotoKeys.length, at: c.supplierRespondedAt, by: name(c.supplierRespondedBy) },
    decision: c.decidedAt ? {
      outcome: c.outcome, fault: as === "BUYER" && c.fault !== "CUSTOMER" ? null : c.fault, note: c.decisionNote, at: c.decidedAt, by: as === "ADMIN" ? name(c.decidedById) : null,
      credit: as === "VENDOR" ? null : c.creditGross === null ? null : Number(c.creditGross), creditDeliveryFee: c.creditDeliveryFee,
      creditNoteId: as === "VENDOR" ? null : c.creditNoteId, replacementDoneAt: c.replacementDoneAt,
    } : null,
    lines: c.lines.map((l) => ({
      id: l.id, orderLineId: l.orderLineId, sku: l.orderLine.sku, product: pick(l.orderLine.productName), packaging: pick(l.orderLine.packagingName), delivered: l.orderLine.qtyDelivered ?? 0,
      qty: l.qty, approvedQty: l.approvedQty, lotCode: l.lotCode,
      unitGross: inv ? r2(inv.unit.get(l.orderLineId)?.gross ?? 0) : null, // buyer + FIRINGI only
      unitCost: as === "BUYER" ? null : vendorCost(l), // supplier + FIRINGI only
    })),
    invoice: inv ? { id: inv.id, number: inv.number, fee: inv.feeLine ? r2(inv.feeLine.gross) : null } : null,
    delivery,
    messages: c.messages.filter((m) => as === "ADMIN" || !m.internal).map((m) => ({
      id: m.id, body: m.body, at: m.createdAt, by: name(m.authorUserId), side: companyType.get(m.authorCompanyId) === "ADMIN" ? "FIRINGI" : m.authorCompanyId === c.buyerCompanyId ? "CUSTOMER" : "SUPPLIER",
      internal: m.internal, photos: m.photoKeys.length,
    })),
    chargebacks: as === "BUYER" ? [] : c.chargebacks.filter((x) => as === "ADMIN" || (x.target === "SUPPLIER" && x.vendorCompanyId === ctx.company.id)).map((x) => ({
      id: x.id, target: x.target, amount: Number(x.amount), status: x.status, driver: x.driver?.user.name ?? null, disputeNote: x.disputeNote, resolutionNote: x.resolutionNote, deductedRef: x.deductedRef,
    })),
    can: {
      withdraw: as === "BUYER" && c.status === "OPEN" && can(ctx, "buyer.claims.manage"),
      respond: as === "VENDOR" && c.status === "OPEN" && can(ctx, "vendor.claims.respond"),
      replace: (as === "VENDOR" ? can(ctx, "vendor.claims.respond") : as === "ADMIN" && can(ctx, "admin.claims.manage")) && c.status === "APPROVED" && c.outcome === "REPLACEMENT" && !c.replacementDoneAt,
      decide: as === "ADMIN" && c.status === "OPEN" && can(ctx, "admin.claims.manage"),
      message: as === "ADMIN" ? can(ctx, "admin.claims.manage") : as === "VENDOR" ? can(ctx, "vendor.claims.respond") : can(ctx, "buyer.claims.manage"),
    },
  };
}

/** Photo n of the claim (`who`: the customer's, the supplier's, or a message's). */
export async function claimPhotoKey(ctx: Ctx, id: string, who: "c" | "s" | `m${string}`, n: number) {
  const { as } = await loadClaim(ctx, id);
  const c = await prisma.qualityClaim.findUniqueOrThrow({ where: { id }, select: { photoKeys: true, supplierPhotoKeys: true } });
  let keys: string[] = [];
  if (who === "c") keys = c.photoKeys;
  else if (who === "s") keys = c.supplierPhotoKeys;
  else {
    const m = await prisma.claimMessage.findFirst({ where: { id: who.slice(1), claimId: id } });
    if (!m || (m.internal && as !== "ADMIN")) throw new NotFoundError("File");
    keys = m.photoKeys;
  }
  const key = keys[n];
  if (!key) throw new NotFoundError("File");
  return key;
}

// ── conversation & the supplier's side ──────────────────────────────────────

export async function addClaimMessage(ctx: Ctx, id: string, input: { body: string; internal?: boolean; photos?: File[] }) {
  const d = await claimDetail(ctx, id);
  if (!d.can.message) throw new ForbiddenError();
  const body = input.body.trim();
  if (body.length < 2) throw new ValidationError("Write a message.");
  const internal = d.as === "ADMIN" && !!input.internal;
  const photoKeys = await storePhotos(input.photos, 4);
  const m = await prisma.claimMessage.create({ data: { claimId: id, authorCompanyId: ctx.company.id, authorUserId: ctx.user.id, body, internal, photoKeys } });
  if (!internal) {
    const admin = await adminCompanyId();
    const targets = [
      ...(d.as !== "ADMIN" && admin ? [{ companyId: admin, link: `/admin/orders/claims/${id}` }] : []),
      ...(d.as !== "BUYER" ? [{ companyId: d.buyer.id, link: `/buy/orders/claims/${id}` }] : []),
      ...(d.as !== "VENDOR" ? [{ companyId: d.seller.id, link: `/vendor/orders/claims/${id}` }] : []),
    ];
    await notify("claim.message", targets, { number: d.number }, { ref: { type: "QualityClaim", id } });
  }
  return m;
}

export async function respondAsSupplier(ctx: Ctx, id: string, input: { response: "ACCEPTED" | "DISPUTED"; comment: string; photos?: File[] }) {
  const d = await claimDetail(ctx, id);
  if (!d.can.respond) throw new AppError("BAD_TRANSITION", "This claim can't be answered any more.", 409);
  const comment = input.comment.trim();
  if (input.response === "DISPUTED" && comment.length < 5) throw new ValidationError("Explain why you dispute the claim.");
  const photoKeys = await storePhotos(input.photos, 4);
  await prisma.$transaction(async (tx) => {
    await tx.qualityClaim.update({ where: { id }, data: { supplierResponse: input.response, supplierComment: comment || null, supplierPhotoKeys: photoKeys.length ? photoKeys : undefined, supplierRespondedAt: new Date(), supplierRespondedBy: ctx.user.id } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "claim.supplier_responded", entityType: "QualityClaim", entityId: id, after: { response: input.response, comment } }, tx);
  });
  const admin = await adminCompanyId();
  if (admin) await notify("claim.supplier_responded", [{ companyId: admin, link: `/admin/orders/claims/${id}` }], { number: d.number, response: input.response === "ACCEPTED" ? "accepted" : "disputed" }, { ref: { type: "QualityClaim", id } });
}

export async function withdrawClaim(ctx: Ctx, id: string) {
  const d = await claimDetail(ctx, id);
  if (!d.can.withdraw) throw new AppError("BAD_TRANSITION", "Only an open claim can be withdrawn.", 409);
  await prisma.$transaction(async (tx) => {
    await tx.qualityClaim.update({ where: { id, status: "OPEN" }, data: { status: "WITHDRAWN" } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "claim.withdrawn", entityType: "QualityClaim", entityId: id }, tx);
  });
}

// ── FIRINGI decides ─────────────────────────────────────────────────────────

export type ClaimDecision = {
  decision: "APPROVE" | "REJECT";
  outcome?: ClaimOutcome; // APPROVE
  fault: ClaimFault;
  lines?: { lineId: string; approvedQty: number }[]; // APPROVE (claim line ids)
  creditDeliveryFee?: boolean;
  driverAmount?: number | null; // DRIVER fault: charge-back (≤ the driver's pay for the delivery); 0/null = none
  note?: string | null;
};

/** What a decision would credit (gross) — for the form and the four-eyes threshold. */
export async function creditPreview(claimId: string, d: Pick<ClaimDecision, "lines" | "creditDeliveryFee">) {
  const c = await prisma.qualityClaim.findUniqueOrThrow({ where: { id: claimId }, include: { lines: true } });
  const inv = await invoiceFacts(c.orderId);
  if (!inv) return { gross: 0, invoice: null };
  let gross = 0;
  for (const l of d.lines ?? []) {
    const cl = c.lines.find((x) => x.id === l.lineId);
    if (cl) gross += (inv.unit.get(cl.orderLineId)?.gross ?? 0) * l.approvedQty;
  }
  if (d.creditDeliveryFee && inv.feeLine) gross += inv.feeLine.gross;
  return { gross: r2(gross), invoice: inv };
}

export async function decideClaim(ctx: Ctx, id: string, input: ClaimDecision) {
  assertAdmin(ctx, true);
  const c = await prisma.qualityClaim.findUnique({ where: { id }, include: { lines: true, order: { select: { number: true } } } });
  if (!c) throw new NotFoundError("Claim");
  if (c.status !== "OPEN") throw new AppError("BAD_TRANSITION", "This claim was already decided.", 409);
  const note = input.note?.trim() || null;
  const targets = [{ companyId: c.buyerCompanyId, link: `/buy/orders/claims/${id}` }, { companyId: c.sellerCompanyId, link: `/vendor/orders/claims/${id}` }];

  if (input.decision === "REJECT") {
    if (!note || note.length < 5) throw new ValidationError("Give the reason for rejecting the claim — the customer sees it.");
    await prisma.$transaction(async (tx) => {
      await tx.qualityClaim.update({ where: { id, status: "OPEN" }, data: { status: "REJECTED", fault: "CUSTOMER", decisionNote: note, decidedById: ctx.user.id, decidedAt: new Date() } });
      await tx.qualityClaimLine.updateMany({ where: { claimId: id }, data: { approvedQty: 0 } });
      await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "claim.rejected", entityType: "QualityClaim", entityId: id, after: { note } }, tx);
    });
    await notify("claim.decided", targets, { number: c.number, decision: "REJECTED", note }, { ref: { type: "QualityClaim", id } });
    return { number: c.number, creditNote: null as string | null };
  }

  if (input.fault === "CUSTOMER") throw new ValidationError("A claim that is the customer's own fault is rejected, not approved.");
  const outcome = input.outcome ?? "CREDIT";
  if (outcome === "REPLACEMENT" && input.fault !== "SUPPLIER") throw new ValidationError("A replacement is delivered by the supplier — only when the supplier is at fault.");
  const lines = (input.lines ?? []).filter((l) => l.approvedQty > 0);
  for (const l of input.lines ?? []) {
    const cl = c.lines.find((x) => x.id === l.lineId);
    if (!cl || !Number.isInteger(l.approvedQty) || l.approvedQty < 0 || l.approvedQty > cl.qty) throw new ValidationError("Approve at most the claimed quantity per line.");
  }
  if (!lines.length) throw new ValidationError("Approve a quantity on at least one line (or reject the claim).");
  if (input.creditDeliveryFee && outcome !== "CREDIT") throw new ValidationError("The delivery fee can only be credited with a credit note.");

  const delivery = await deliveryFacts(c.orderId);
  const driverAmount = input.fault === "DRIVER" ? r2(Math.max(0, input.driverAmount ?? 0)) : 0;
  if (driverAmount > 0) {
    if (!delivery.driverChargeback.eligible || !delivery.driverId) {
      throw new ValidationError(delivery.driverChargeback.why === "FREE_DELIVERY"
        ? "No charge-back: the customer paid no delivery fee, so the driver earned no per-delivery pay for it."
        : delivery.driverChargeback.why === "SUPPLIER_FLEET" ? "No charge-back: the supplier's own fleet delivered — its drivers are the supplier's staff (choose supplier fault)." : "No charge-back: no FIRINGI driver delivered this order.");
    }
    if (driverAmount > delivery.driverChargeback.cap + 0.001) throw new ValidationError(`The charge-back can't be more than the driver's pay for this delivery (${delivery.driverChargeback.cap.toFixed(2)} €).`);
  }
  if (input.fault === "DRIVER" && !delivery.firingiFleet) throw new ValidationError("This order was delivered by the supplier's own fleet — delivery faults are the supplier's.");

  let preview = { gross: 0, invoice: null as Awaited<ReturnType<typeof invoiceFacts>> };
  if (outcome === "CREDIT") {
    preview = await creditPreview(id, { lines, creditDeliveryFee: input.creditDeliveryFee });
    if (!preview.invoice) throw new AppError("NO_INVOICE", "The order has no issued invoice yet — it can't be credited.", 409);
    const { approvalSettings, fourEyes } = await import("@/server/approvals/gate");
    const a = await approvalSettings();
    if (a.enabled && preview.gross > a.creditNoteAbove)
      await fourEyes(ctx, { kind: "CLAIM", amount: preview.gross, companyId: c.buyerCompanyId, summary: `Claim ${c.number} (order ${c.order.number}): credit ${preview.gross.toFixed(2)} € — ${input.fault.toLowerCase()} fault`, payload: { claimId: id, input } });
  }

  const result = await prisma.$transaction(async (tx) => {
    let creditNote: { id: string; fullNumber: string | null; creditStatementId: string | null; gross: number } | null = null;
    if (outcome === "CREDIT") {
      const inv = preview.invoice!;
      const sel = lines.map((l) => ({ invoiceLineId: inv.unit.get(c.lines.find((x) => x.id === l.lineId)!.orderLineId)!.lineId, qty: l.approvedQty }));
      if (input.creditDeliveryFee && inv.feeLine) sel.push({ invoiceLineId: inv.feeLine.lineId, qty: 1 });
      const cn = await creditInvoice(tx, inv.id, { lines: sel, reason: `Reclamação ${c.number}`, actorUserId: ctx.user.id, chargeVendor: input.fault === "SUPPLIER" });
      creditNote = { id: cn.id, fullNumber: cn.fullNumber, creditStatementId: cn.creditStatementId, gross: Number(cn.grossTotal) };
    }
    await tx.qualityClaim.update({
      where: { id, status: "OPEN" },
      data: { status: "APPROVED", outcome, fault: input.fault, decisionNote: note, decidedById: ctx.user.id, decidedAt: new Date(), creditNoteId: creditNote?.id ?? null,
        creditGross: creditNote ? creditNote.gross.toFixed(2) : null, creditDeliveryFee: !!input.creditDeliveryFee }, // what the credit note really says
    });
    for (const l of input.lines ?? []) await tx.qualityClaimLine.update({ where: { id: l.lineId }, data: { approvedQty: l.approvedQty } });
    if (input.fault === "SUPPLIER" && creditNote?.creditStatementId) {
      const st = await tx.vendorBillingStatement.findUniqueOrThrow({ where: { id: creditNote.creditStatementId } });
      await tx.claimChargeback.create({ data: { claimId: id, target: "SUPPLIER", vendorCompanyId: c.sellerCompanyId, amount: st.expectedGross, statementId: st.id } });
    }
    if (driverAmount > 0) await tx.claimChargeback.create({ data: { claimId: id, target: "DRIVER", driverId: delivery.driverId!, amount: driverAmount.toFixed(2) } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "claim.approved", entityType: "QualityClaim", entityId: id,
      after: { outcome, fault: input.fault, lines, credit: preview.gross, creditNote: creditNote?.fullNumber ?? null, driverAmount, note } }, tx);
    return creditNote;
  });
  if (result) (await import("@/server/invoicing/fiscal")).kickFiscalQueue();
  await notify("claim.decided", targets, { number: c.number, decision: outcome, note }, { ref: { type: "QualityClaim", id } });
  if (input.fault === "SUPPLIER" && outcome === "CREDIT") await notify("claim.chargeback", [{ companyId: c.sellerCompanyId, link: `/vendor/orders/claims/${id}` }], { number: c.number }, { ref: { type: "QualityClaim", id } });
  return { number: c.number, creditNote: result?.fullNumber ?? null };
}

/** The supplier (or FIRINGI) confirms the replacement goods were delivered. */
export async function markReplacementDone(ctx: Ctx, id: string) {
  const d = await claimDetail(ctx, id);
  if (!d.can.replace) throw new AppError("BAD_TRANSITION", "No replacement is pending on this claim.", 409);
  await prisma.$transaction(async (tx) => {
    await tx.qualityClaim.update({ where: { id }, data: { replacementDoneAt: new Date(), replacementById: ctx.user.id } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "claim.replacement_delivered", entityType: "QualityClaim", entityId: id }, tx);
  });
  await notify("claim.replaced", [{ companyId: d.buyer.id, link: `/buy/orders/claims/${id}` }], { number: d.number }, { ref: { type: "QualityClaim", id } });
}

// ── charge-backs ────────────────────────────────────────────────────────────

/** Supplier charge-backs settle through the supplier's credit note on the credit statement. */
export async function syncChargebacks() {
  const open = await prisma.claimChargeback.findMany({ where: { target: "SUPPLIER", status: { in: ["OPEN", "DISPUTED"] }, statementId: { not: null } }, select: { id: true, status: true, statementId: true } });
  if (!open.length) return 0;
  const sts = new Map((await prisma.vendorBillingStatement.findMany({ where: { id: { in: open.map((o) => o.statementId!) } }, select: { id: true, number: true, status: true } })).map((s) => [s.id, s]));
  let n = 0;
  for (const cb of open) {
    const st = sts.get(cb.statementId!);
    if (cb.status === "OPEN" && st && (st.status === "MATCHED" || st.status === "CLOSED")) {
      await prisma.claimChargeback.update({ where: { id: cb.id }, data: { status: "DEDUCTED", deductedAt: new Date(), deductedRef: st.number } });
      n++;
    }
  }
  return n;
}

export async function listChargebacks(ctx: Ctx, as: "VENDOR" | "ADMIN", f: { status?: "OPEN" | "DISPUTED" | "DEDUCTED" | "WAIVED"; target?: "SUPPLIER" | "DRIVER" } = {}) {
  const where: Prisma.ClaimChargebackWhereInput = {};
  if (f.status) where.status = f.status;
  if (as === "VENDOR") {
    if (!can(ctx, ["vendor.claims.respond", "vendor.invoices.view"])) throw new ForbiddenError();
    Object.assign(where, { target: "SUPPLIER", vendorCompanyId: ctx.company.id });
  } else {
    if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.claims.manage", "admin.finance.view", "admin.fleet.view"])) throw new ForbiddenError();
    if (f.target) where.target = f.target;
  }
  await syncChargebacks();
  const rows = await prisma.claimChargeback.findMany({
    where, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 300,
    include: { claim: { select: { id: true, number: true, reason: true, order: { select: { number: true } } } }, vendor: { select: { legalName: true, tradeName: true } }, driver: { select: { user: { select: { name: true } } } } },
  });
  const statements = new Map((await prisma.vendorBillingStatement.findMany({ where: { id: { in: rows.map((r) => r.statementId).filter((x): x is string => !!x) } }, select: { id: true, number: true, status: true } })).map((s) => [s.id, s]));
  return rows.map((r) => ({
    id: r.id, target: r.target, amount: Number(r.amount), status: r.status, createdAt: r.createdAt, claimId: r.claim.id, claimNumber: r.claim.number, reason: r.claim.reason, orderNumber: r.claim.order.number,
    who: r.target === "SUPPLIER" ? r.vendor?.tradeName ?? r.vendor?.legalName ?? "—" : r.driver?.user.name ?? "—",
    statement: r.statementId ? statements.get(r.statementId) ?? null : null, disputeNote: r.disputeNote, resolutionNote: r.resolutionNote, deductedRef: r.deductedRef, deductedAt: r.deductedAt,
  }));
}

export async function disputeChargeback(ctx: Ctx, id: string, note: string) {
  if (!can(ctx, "vendor.claims.respond")) throw new ForbiddenError();
  const cb = await prisma.claimChargeback.findFirst({ where: { id, target: "SUPPLIER", vendorCompanyId: ctx.company.id }, include: { claim: { select: { number: true, id: true } } } });
  if (!cb) throw new NotFoundError("Charge-back");
  if (cb.status !== "OPEN") throw new AppError("BAD_TRANSITION", "Only an open charge-back can be disputed.", 409);
  if (note.trim().length < 5) throw new ValidationError("Explain why you dispute the charge-back.");
  await prisma.$transaction(async (tx) => {
    await tx.claimChargeback.update({ where: { id }, data: { status: "DISPUTED", disputeNote: note.trim(), disputedAt: new Date(), disputedById: ctx.user.id } });
    if (cb.statementId) await tx.vendorBillingStatement.updateMany({ where: { id: cb.statementId, status: "OPEN" }, data: { status: "DISPUTED" } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "chargeback.disputed", entityType: "ClaimChargeback", entityId: id, after: { note } }, tx);
  });
  const admin = await adminCompanyId();
  if (admin) await notify("claim.chargeback_disputed", [{ companyId: admin, link: "/admin/orders/claims/chargebacks" }], { number: cb.claim.number }, { ref: { type: "QualityClaim", id: cb.claim.id } });
}

/** FIRINGI: keep (uphold) or drop (waive) a charge-back; mark a driver's as deducted from pay. */
export async function resolveChargeback(ctx: Ctx, id: string, input: { action: "UPHOLD" | "WAIVE" | "DEDUCTED"; note?: string | null }) {
  assertAdmin(ctx, true);
  const cb = await prisma.claimChargeback.findUnique({ where: { id }, include: { claim: { select: { id: true, number: true } } } });
  if (!cb) throw new NotFoundError("Charge-back");
  const note = input.note?.trim() || null;
  if (input.action === "UPHOLD" && cb.status !== "DISPUTED") throw new AppError("BAD_TRANSITION", "Only a disputed charge-back can be upheld.", 409);
  if (input.action === "WAIVE" && !["OPEN", "DISPUTED"].includes(cb.status)) throw new AppError("BAD_TRANSITION", "This charge-back is already settled.", 409);
  if (input.action === "WAIVE" && !note) throw new ValidationError("Say why the charge-back is waived.");
  if (input.action === "DEDUCTED" && (cb.status !== "OPEN" || cb.target !== "DRIVER")) throw new AppError("BAD_TRANSITION", "Only an open driver charge-back is marked as deducted here (supplier ones settle through the supplier's credit note).", 409);
  await prisma.$transaction(async (tx) => {
    if (input.action === "UPHOLD") {
      await tx.claimChargeback.update({ where: { id }, data: { status: "OPEN", resolvedById: ctx.user.id, resolvedAt: new Date(), resolutionNote: note } });
      if (cb.statementId) await tx.vendorBillingStatement.updateMany({ where: { id: cb.statementId, status: "DISPUTED" }, data: { status: "OPEN" } });
    } else if (input.action === "WAIVE") {
      await tx.claimChargeback.update({ where: { id }, data: { status: "WAIVED", resolvedById: ctx.user.id, resolvedAt: new Date(), resolutionNote: note } });
      // FIRINGI carries the credit: the supplier needn't issue its credit note any more.
      if (cb.statementId) await tx.vendorBillingStatement.updateMany({ where: { id: cb.statementId, status: { in: ["OPEN", "DISPUTED"] } }, data: { status: "CLOSED" } });
    } else {
      await tx.claimChargeback.update({ where: { id }, data: { status: "DEDUCTED", deductedAt: new Date(), deductedRef: note ?? "Driver pay", resolvedById: ctx.user.id, resolvedAt: new Date() } });
    }
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `chargeback.${input.action.toLowerCase()}`, entityType: "ClaimChargeback", entityId: id, after: { note } }, tx);
  });
  if (cb.target === "SUPPLIER" && cb.vendorCompanyId && input.action !== "DEDUCTED")
    await notify("claim.chargeback_resolved", [{ companyId: cb.vendorCompanyId, link: `/vendor/orders/claims/${cb.claim.id}` }], { number: cb.claim.number, decision: input.action }, { ref: { type: "QualityClaim", id: cb.claim.id } });
}

/** Open supplier charge-backs per supplier — shown on the payouts list (they net off what FIRINGI pays). */
export async function openSupplierChargebacks() {
  const rows = await prisma.claimChargeback.groupBy({ by: ["vendorCompanyId"], where: { target: "SUPPLIER", status: { in: ["OPEN", "DISPUTED"] } }, _sum: { amount: true }, _count: true });
  return new Map(rows.map((r) => [r.vendorCompanyId!, { amount: r2(Number(r._sum.amount ?? 0)), count: r._count }]));
}

// ── quality scores & alerts ─────────────────────────────────────────────────

type Rates = { since: Date; settings: ClaimSettings };

async function supplierRates({ since }: Rates, sellerId?: string) {
  return prisma.$queryRaw<{ id: string; name: string; delivered: number; claims: number; upheld: number; credited: number }[]>`
    SELECT c.id, COALESCE(c."tradeName", c."legalName") AS name,
      (SELECT count(*) FROM "Order" o WHERE o."sellerCompanyId" = c.id AND o.status = 'DELIVERED' AND o."updatedAt" >= ${since})::int AS delivered,
      (SELECT count(*) FROM "QualityClaim" q WHERE q."sellerCompanyId" = c.id AND q."createdAt" >= ${since})::int AS claims,
      (SELECT count(*) FROM "QualityClaim" q WHERE q."sellerCompanyId" = c.id AND q.status = 'APPROVED' AND q.fault = 'SUPPLIER' AND q."createdAt" >= ${since})::int AS upheld,
      COALESCE((SELECT sum(q."creditGross") FROM "QualityClaim" q WHERE q."sellerCompanyId" = c.id AND q.status = 'APPROVED' AND q."createdAt" >= ${since}), 0)::float8 AS credited
    FROM "Company" c WHERE c.type IN ('DISTRIBUTOR', 'WHOLESALER') AND c.status = 'APPROVED' ${sellerId ? Prisma.sql`AND c.id = ${sellerId}` : Prisma.sql``}`;
}

async function productRates({ since }: Rates, sellerId?: string) {
  return prisma.$queryRaw<{ offerId: string; seller: string; sellerId: string; product: unknown; units: number; claimed: number; upheld: number; claims: number }[]>`
    WITH d AS (
      SELECT l."offerId", sum(l."qtyDelivered")::int AS units FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId"
      WHERE o.status = 'DELIVERED' AND o."updatedAt" >= ${since} ${sellerId ? Prisma.sql`AND o."sellerCompanyId" = ${sellerId}` : Prisma.sql``} GROUP BY 1
    ), q AS (
      SELECT ql."offerId", count(DISTINCT q.id)::int AS claims, sum(ql.qty)::int AS claimed, COALESCE(sum(CASE WHEN q.status = 'APPROVED' AND q.fault = 'SUPPLIER' THEN ql."approvedQty" ELSE 0 END), 0)::int AS upheld
      FROM "QualityClaimLine" ql JOIN "QualityClaim" q ON q.id = ql."claimId" WHERE q."createdAt" >= ${since} AND q.status <> 'WITHDRAWN' ${sellerId ? Prisma.sql`AND q."sellerCompanyId" = ${sellerId}` : Prisma.sql``} GROUP BY 1
    )
    SELECT q."offerId", COALESCE(c."tradeName", c."legalName") AS seller, c.id AS "sellerId", p.name AS product, COALESCE(d.units, 0) AS units, q.claimed, q.upheld, q.claims
    FROM q JOIN "VendorOffer" vo ON vo.id = q."offerId" JOIN "PackagingUnit" pu ON pu.id = vo."packagingUnitId" JOIN "ProductVariant" pv ON pv.id = pu."variantId" JOIN "Product" p ON p.id = pv."productId" JOIN "Company" c ON c.id = vo."vendorCompanyId" LEFT JOIN d ON d."offerId" = q."offerId"
    ORDER BY q.claimed DESC LIMIT 200`;
}

async function lotRates({ since }: Rates, sellerId?: string) {
  return prisma.$queryRaw<{ offerId: string; lotCode: string; product: unknown; seller: string; sellerId: string; claims: number; units: number }[]>`
    SELECT ql."offerId", ql."lotCode", p.name AS product, COALESCE(c."tradeName", c."legalName") AS seller, c.id AS "sellerId", count(DISTINCT q.id)::int AS claims, sum(ql.qty)::int AS units
    FROM "QualityClaimLine" ql JOIN "QualityClaim" q ON q.id = ql."claimId" JOIN "VendorOffer" vo ON vo.id = ql."offerId" JOIN "PackagingUnit" pu ON pu.id = vo."packagingUnitId" JOIN "ProductVariant" pv ON pv.id = pu."variantId" JOIN "Product" p ON p.id = pv."productId" JOIN "Company" c ON c.id = vo."vendorCompanyId"
    WHERE ql."lotCode" IS NOT NULL AND q."createdAt" >= ${since} AND q.status <> 'WITHDRAWN' ${sellerId ? Prisma.sql`AND q."sellerCompanyId" = ${sellerId}` : Prisma.sql``}
    GROUP BY 1, 2, 3, 4, 5 ORDER BY claims DESC LIMIT 100`;
}

async function driverRates({ since }: Rates) {
  return prisma.$queryRaw<{ id: string; name: string; delivered: number; claims: number; charged: number }[]>`
    SELECT dr.id, u.name,
      (SELECT count(*) FROM "Delivery" d WHERE d."driverId" = dr.id AND d.status = 'DELIVERED' AND d."completedAt" >= ${since})::int AS delivered,
      (SELECT count(*) FROM "QualityClaim" q JOIN "Delivery" d ON d."orderId" = q."orderId" WHERE d."driverId" = dr.id AND q.status = 'APPROVED' AND q.fault = 'DRIVER' AND q."createdAt" >= ${since})::int AS claims,
      COALESCE((SELECT sum(cb.amount) FROM "ClaimChargeback" cb WHERE cb."driverId" = dr.id AND cb.status IN ('OPEN', 'DEDUCTED') AND cb."createdAt" >= ${since}), 0)::float8 AS charged
    FROM "Driver" dr JOIN "User" u ON u.id = dr."userId" JOIN "Company" oc ON oc.id = dr."ownerCompanyId" WHERE oc.type = 'ADMIN'`;
}

/** FIRINGI quality overview: rates per supplier, product, lot and FIRINGI driver; open alerts. */
export async function qualityOverview(ctx: Ctx, days = 30) {
  assertAdmin(ctx);
  const settings = await claimSettings();
  const r: Rates = { since: new Date(Date.now() - days * DAY), settings };
  const [suppliers, products, lots, drivers, alerts, byReason, statuses] = await Promise.all([
    supplierRates(r), productRates(r), lotRates(r), driverRates(r),
    prisma.qualityAlert.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" } }),
    prisma.qualityClaim.groupBy({ by: ["reason"], where: { createdAt: { gte: r.since } }, _count: true }),
    prisma.qualityClaim.groupBy({ by: ["status"], where: { createdAt: { gte: r.since } }, _count: true, _sum: { creditGross: true } }),
  ]);
  const decidedRows = await prisma.qualityClaim.findMany({ where: { decidedAt: { gte: r.since } }, select: { createdAt: true, decidedAt: true, dueBy: true } });
  const hours = decidedRows.map((x) => (x.decidedAt!.getTime() - x.createdAt.getTime()) / HOUR).sort((a, b) => a - b);
  return {
    days, settings,
    totals: {
      claims: statuses.reduce((a, s) => a + s._count, 0), open: statuses.find((s) => s.status === "OPEN")?._count ?? 0,
      approved: statuses.find((s) => s.status === "APPROVED")?._count ?? 0, rejected: statuses.find((s) => s.status === "REJECTED")?._count ?? 0,
      credited: r2(Number(statuses.find((s) => s.status === "APPROVED")?._sum.creditGross ?? 0)),
      medianHours: hours.length ? r2(hours[Math.floor(hours.length / 2)]) : null,
      withinSla: decidedRows.length ? decidedRows.filter((x) => x.decidedAt! <= x.dueBy).length / decidedRows.length : null,
    },
    byReason: CLAIM_REASONS.map((k) => ({ reason: k, count: byReason.find((b) => b.reason === k)?._count ?? 0 })),
    suppliers: suppliers.filter((s) => s.claims > 0 || s.delivered > 0).map((s) => ({ ...s, rate: s.delivered ? s.upheld / s.delivered : null })).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.claims - a.claims),
    products: products.map((p) => ({ ...p, product: pick(p.product), rate: p.units ? p.claimed / p.units : null })),
    lots: lots.map((l) => ({ ...l, product: pick(l.product) })),
    drivers: drivers.filter((d) => d.delivered > 0 || d.claims > 0).map((d) => ({ ...d, rate: d.delivered ? d.claims / d.delivered : null })).sort((a, b) => b.claims - a.claims),
    alerts,
  };
}

/** A supplier's own quality: its claim rate, products and lots claimed (30 days). */
export async function myQuality(ctx: Ctx, days = 30) {
  if (!can(ctx, ["vendor.claims.respond", "vendor.orders.view"])) throw new ForbiddenError();
  const settings = await claimSettings();
  const r: Rates = { since: new Date(Date.now() - days * DAY), settings };
  const [s, products, lots, alerts] = await Promise.all([
    supplierRates(r, ctx.company.id), productRates(r, ctx.company.id), lotRates(r, ctx.company.id),
    prisma.qualityAlert.findMany({ where: { companyId: ctx.company.id, status: "OPEN" }, orderBy: { createdAt: "desc" } }),
  ]);
  const me = s[0] ?? { delivered: 0, claims: 0, upheld: 0, credited: 0 };
  return {
    days, threshold: settings.supplierRatePct, delivered: me.delivered, claims: me.claims, upheld: me.upheld, rate: me.delivered ? me.upheld / me.delivered : null,
    products: products.map((p) => ({ offerId: p.offerId, product: pick(p.product), units: p.units, claimed: p.claimed, claims: p.claims, rate: p.units ? p.claimed / p.units : null })),
    lots: lots.map((l) => ({ lotCode: l.lotCode, product: pick(l.product), claims: l.claims, units: l.units })),
    alerts: alerts.map((a) => ({ id: a.id, kind: a.kind, label: a.label, value: a.value, threshold: a.threshold, claims: a.claims, createdAt: a.createdAt })),
  };
}

export async function acknowledgeAlert(ctx: Ctx, id: string) {
  assertAdmin(ctx, true);
  const a = await prisma.qualityAlert.findUnique({ where: { id } });
  if (!a) throw new NotFoundError("Alert");
  if (a.status !== "OPEN") return;
  await prisma.qualityAlert.update({ where: { id }, data: { status: "ACKNOWLEDGED", acknowledgedBy: ctx.user.id, acknowledgedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "quality_alert.acknowledged", entityType: "QualityAlert", entityId: id });
}

/** Thresholds crossed in the last 30 days → one alert per key (not again within 30 days of the last one). */
export async function computeAlerts(now = new Date()) {
  const settings = await claimSettings();
  const r: Rates = { since: new Date(now.getTime() - 30 * DAY), settings };
  const [suppliers, products, lots, drivers] = await Promise.all([supplierRates(r), productRates(r), lotRates(r), driverRates(r)]);
  const wanted: { kind: "SUPPLIER_RATE" | "PRODUCT_RATE" | "LOT" | "DRIVER"; key: string; label: string; companyId: string | null; value: number; threshold: number; claims: number }[] = [];
  for (const s of suppliers) if (s.delivered >= settings.minDeliveries && (s.upheld / s.delivered) * 100 >= settings.supplierRatePct)
    wanted.push({ kind: "SUPPLIER_RATE", key: `SUPPLIER:${s.id}`, label: s.name, companyId: s.id, value: r2((s.upheld / s.delivered) * 100), threshold: settings.supplierRatePct, claims: s.upheld });
  for (const p of products) if (p.units >= settings.minDeliveries && (p.claimed / p.units) * 100 >= settings.productRatePct)
    wanted.push({ kind: "PRODUCT_RATE", key: `PRODUCT:${p.offerId}`, label: `${pick(p.product)} — ${p.seller}`, companyId: p.sellerId, value: r2((p.claimed / p.units) * 100), threshold: settings.productRatePct, claims: p.claims });
  for (const l of lots) if (l.claims >= settings.lotClaims)
    wanted.push({ kind: "LOT", key: `LOT:${l.offerId}:${l.lotCode}`, label: `${pick(l.product)} — lot ${l.lotCode} (${l.seller})`, companyId: l.sellerId, value: l.claims, threshold: settings.lotClaims, claims: l.claims });
  for (const d of drivers) if (d.claims >= settings.driverClaims)
    wanted.push({ kind: "DRIVER", key: `DRIVER:${d.id}`, label: d.name, companyId: null, value: d.claims, threshold: settings.driverClaims, claims: d.claims });
  const recent = await prisma.qualityAlert.findMany({ where: { key: { in: wanted.map((w) => w.key) }, OR: [{ status: "OPEN" }, { createdAt: { gte: r.since } }] }, select: { key: true, status: true, id: true } });
  const created: typeof wanted = [];
  for (const w of wanted) {
    const ex = recent.find((x) => x.key === w.key);
    if (ex?.status === "OPEN") { await prisma.qualityAlert.update({ where: { id: ex.id }, data: { value: w.value, claims: w.claims, label: w.label } }); continue; }
    if (ex) continue; // acknowledged within 30 days
    await prisma.qualityAlert.create({ data: w });
    created.push(w);
  }
  if (created.length) {
    const admin = await adminCompanyId();
    for (const w of created) {
      const pct = w.kind === "SUPPLIER_RATE" || w.kind === "PRODUCT_RATE";
      const vars = { label: w.label, value: pct ? `${w.value.toFixed(1)} %` : String(w.value), threshold: pct ? `${w.threshold} %` : String(w.threshold) };
      const targets = [...(admin ? [{ companyId: admin, link: "/admin/orders/claims/quality" }] : []), ...(w.companyId ? [{ companyId: w.companyId, link: "/vendor/orders/claims/quality" }] : [])];
      await notify("quality.alert", targets, vars);
    }
  }
  return { alerts: wanted.length, created: created.length };
}

const OVERDUE_KEY = "claims.overdue_reminded";

/** Daily: settle charge-backs, tell FIRINGI about claims past the SLA, compute quality alerts. */
export async function runClaimsJob(now = new Date()) {
  const settled = await syncChargebacks();
  const overdue = await prisma.qualityClaim.count({ where: { status: "OPEN", dueBy: { lt: now } } });
  const today = now.toISOString().slice(0, 10);
  let reminded = false;
  if (overdue) {
    const last = await prisma.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: OVERDUE_KEY } } });
    if ((last?.value as { day?: string } | null)?.day !== today) {
      const admin = await adminCompanyId();
      if (admin) await notify("claim.overdue", [{ companyId: admin, link: "/admin/orders/claims?status=OVERDUE" }], { count: String(overdue) });
      await prisma.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: OVERDUE_KEY } }, update: { value: { day: today } }, create: { scope: "GLOBAL", key: OVERDUE_KEY, value: { day: today } } });
      reminded = true;
    }
  }
  // Suppliers that haven't answered within their time: one reminder per claim.
  const s = await claimSettings();
  const late = await prisma.qualityClaim.findMany({ where: { status: "OPEN", supplierResponse: null, createdAt: { lt: new Date(now.getTime() - s.supplierResponseHours * HOUR) } }, select: { id: true, number: true, sellerCompanyId: true } });
  const asked = new Set((await prisma.auditLog.findMany({ where: { action: "claim.supplier_reminded", entityId: { in: late.map((l) => l.id) } }, select: { entityId: true } })).map((a) => a.entityId));
  let supplierReminders = 0;
  for (const c of late.filter((l) => !asked.has(l.id))) {
    await notify("claim.answer_needed", [{ companyId: c.sellerCompanyId, link: `/vendor/orders/claims/${c.id}` }], { number: c.number }, { ref: { type: "QualityClaim", id: c.id } });
    await writeAudit({ actorUserId: null, actorCompanyId: null, action: "claim.supplier_reminded", entityType: "QualityClaim", entityId: c.id });
    supplierReminders++;
  }
  const alerts = await computeAlerts(now);
  return { settled, overdue, reminded, supplierReminders, ...alerts };
}

/** Claims for one order (the order pages link to them). */
export async function claimsForOrder(orderId: string) {
  return prisma.qualityClaim.findMany({ where: { orderId }, select: { id: true, number: true, status: true, reason: true, createdAt: true }, orderBy: { createdAt: "desc" } });
}

export const CLAIM_DECISION_FAULTS: ClaimFault[] = ["SUPPLIER", "DRIVER", "FIRINGI"];

// ── system claims (Phase 42) ────────────────────────────────────────────────

/**
 * A temperature claim opened and credited by the platform itself: goods refused at the door because their
 * temperature was out of range (cold chain). Opened and approved at once — the refusal is the evidence (the
 * readings are on the order) — with the fault worked out from the readings. No four-eyes step: the amount is
 * what the customer didn't take. Returns the claim, or null when the order has no invoice to credit.
 */
export async function systemTemperatureClaim(i: { orderId: string; lines: { orderLineId: string; qty: number }[]; fault: ClaimFault; description: string; actorUserId: string }) {
  const wanted = i.lines.filter((l) => l.qty > 0);
  if (!wanted.length) return null;
  const inv = await invoiceFacts(i.orderId);
  if (!inv) return null;
  const order = await prisma.order.findUniqueOrThrow({ where: { id: i.orderId }, select: { id: true, number: true, buyerCompanyId: true, sellerCompanyId: true } });
  const offers = await prisma.orderLine.findMany({ where: { id: { in: wanted.map((w) => w.orderLineId) } }, select: { id: true, offerId: true } });
  const sel = wanted.filter((w) => inv.unit.has(w.orderLineId)).map((w) => ({ invoiceLineId: inv.unit.get(w.orderLineId)!.lineId, qty: w.qty }));
  if (!sel.length) return null;
  const s = await claimSettings();
  const created = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx);
    const cn = await creditInvoice(tx, inv.id, { lines: sel, reason: `Reclamação ${number} — temperatura`, actorUserId: i.actorUserId, chargeVendor: i.fault === "SUPPLIER" });
    const cl = await tx.qualityClaim.create({
      data: {
        number, orderId: order.id, buyerCompanyId: order.buyerCompanyId, sellerCompanyId: order.sellerCompanyId, reason: "TEMPERATURE", description: i.description, photoKeys: [],
        preferredOutcome: "CREDIT", status: "APPROVED", outcome: "CREDIT", fault: i.fault, decisionNote: i.description, decidedById: i.actorUserId, decidedAt: new Date(),
        dueBy: new Date(Date.now() + s.slaHours * HOUR), createdById: i.actorUserId, creditNoteId: cn.id, creditGross: Number(cn.grossTotal).toFixed(2),
        lines: { create: wanted.map((w) => ({ orderLineId: w.orderLineId, offerId: offers.find((o) => o.id === w.orderLineId)!.offerId, qty: w.qty, approvedQty: w.qty })) },
      },
    });
    if (i.fault === "SUPPLIER" && cn.creditStatementId) {
      const st = await tx.vendorBillingStatement.findUniqueOrThrow({ where: { id: cn.creditStatementId } });
      await tx.claimChargeback.create({ data: { claimId: cl.id, target: "SUPPLIER", vendorCompanyId: order.sellerCompanyId, amount: st.expectedGross, statementId: st.id } });
    }
    await writeAudit({ actorUserId: i.actorUserId, actorCompanyId: null, action: "claim.temperature_refused", entityType: "QualityClaim", entityId: cl.id, after: { number, orderId: order.id, lines: wanted, fault: i.fault, creditNote: cn.fullNumber } }, tx);
    return cl;
  });
  (await import("@/server/invoicing/fiscal")).kickFiscalQueue();
  await notify("claim.decided", [{ companyId: order.buyerCompanyId, link: `/buy/orders/claims/${created.id}` }, { companyId: order.sellerCompanyId, link: `/vendor/orders/claims/${created.id}` }],
    { number: created.number, decision: "CREDIT", note: i.description }, { ref: { type: "QualityClaim", id: created.id } });
  return created;
}
