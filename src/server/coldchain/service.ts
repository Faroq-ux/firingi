import "server-only";
/**
 * Cold chain & HACCP (Phase 42). Rules in src/lib/cold-chain.ts; docs in docs/cold-chain.md.
 *
 * Temperature classes (FIRINGI) → a default per category → the supplier picks per product → copied on the order line.
 * Readings: supplier at dispatch, driver at loading and handover (online + offline), customer at receipt, vehicle
 * loggers (API). Out of range: alert, the customer may refuse (temperature claim credited at once, fault from the
 * readings), FIRINGI may block the handover, breaches count in scores. Every switch is FIRINGI's (settings).
 */
import { createHash, randomBytes } from "node:crypto";
import type { ColdEquipmentKind, EquipmentLogKind, Prisma, TempStage, TempStatus } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { pickLocalized } from "@/i18n/config";
import {
  classify, effectiveClass, inferFault, mergeColdChainSettings, minutesOutNow, monthRange, nextDue, parseC, rangeLabel, tripStats,
  type ColdChainSettings, type TempRange, type TempStatusValue,
} from "@/lib/cold-chain";

const KEY = "coldchain.settings";
const isStaff = (ctx: Ctx) => ctx.company.type === "ADMIN";
const num = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));
const rangeOf = (c: { minC: unknown; maxC: unknown; toleranceC: unknown }): TempRange => ({ minC: num(c.minC as never), maxC: num(c.maxC as never), toleranceC: num(c.toleranceC as never) ?? 0 });
const cname = (c: { legalName: string; tradeName: string | null } | null | undefined) => (c ? c.tradeName ?? c.legalName : "");

// ── settings ────────────────────────────────────────────────────────────────

export async function coldChainSettings(db: Tx | typeof prisma = prisma): Promise<ColdChainSettings> {
  const row = await db.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeColdChainSettings(row?.value as Partial<ColdChainSettings> | null);
}

export async function saveColdChainSettings(ctx: Ctx, input: ColdChainSettings) {
  if (!isStaff(ctx) || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const b = (x: unknown) => !!x;
  const minutes = Math.round(Number(input.loggerAlertMinutes));
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) throw new ValidationError("The logger alert must be between 1 and 240 minutes.");
  const v: ColdChainSettings = {
    enabled: b(input.enabled),
    record: { supplierDispatch: b(input.record?.supplierDispatch), driverLoading: b(input.record?.driverLoading), driverHandover: b(input.record?.driverHandover), customerReceipt: b(input.record?.customerReceipt), loggers: b(input.record?.loggers) },
    requireHandover: b(input.requireHandover) && b(input.record?.driverHandover),
    actions: { customerRefuse: b(input.actions?.customerRefuse), alert: b(input.actions?.alert), block: b(input.actions?.block), score: b(input.actions?.score) },
    records: { certificate: b(input.records?.certificate), monthly: b(input.records?.monthly), equipment: b(input.records?.equipment), receivingLog: b(input.records?.receivingLog) },
    loggerAlertMinutes: minutes,
  };
  const before = await coldChainSettings();
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "coldchain.settings_saved", entityType: "Setting", entityId: KEY, before, after: v });
  return v;
}

// ── classes ─────────────────────────────────────────────────────────────────

export async function listClasses(locale: string, all = false) {
  const rows = await prisma.tempClass.findMany({ where: all ? {} : { active: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
  return rows.map((c) => ({ id: c.id, code: c.code, name: pickLocalized(c.name as Record<string, string>, locale), names: c.name as Record<string, string>, ...rangeOf(c), coldChain: c.coldChain, active: c.active, sortOrder: c.sortOrder, range: rangeLabel(rangeOf(c)) }));
}

export type ClassInput = { id?: string | null; code: string; nameEn: string; namePt?: string | null; minC?: number | null; maxC?: number | null; toleranceC?: number; coldChain: boolean; active?: boolean; sortOrder?: number };

export async function saveClass(ctx: Ctx, i: ClassInput) {
  if (!isStaff(ctx) || !can(ctx, "admin.catalogue.manage")) throw new ForbiddenError();
  const code = i.code.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (code.length < 2 || code.length > 30) throw new ValidationError("The code is 2 to 30 letters, digits or _.");
  if (!i.nameEn.trim()) throw new ValidationError("Give the class a name.");
  const mn = i.minC == null || (i.minC as unknown) === "" ? null : parseC(i.minC);
  const mx = i.maxC == null || (i.maxC as unknown) === "" ? null : parseC(i.maxC);
  if ((i.minC != null && (i.minC as unknown) !== "" && mn == null) || (i.maxC != null && (i.maxC as unknown) !== "" && mx == null)) throw new ValidationError("Temperatures are between −60 and 80 °C.");
  if (mn != null && mx != null && mn > mx) throw new ValidationError("The minimum can't be above the maximum.");
  if (i.coldChain && mn == null && mx == null) throw new ValidationError("A cold-chain class needs a minimum or a maximum temperature.");
  const tol = Number(i.toleranceC ?? 0);
  if (!Number.isFinite(tol) || tol < 0 || tol > 10) throw new ValidationError("The tolerance is 0 to 10 °C.");
  const data = { code, name: { en: i.nameEn.trim(), pt: (i.namePt ?? "").trim() || i.nameEn.trim() }, minC: mn, maxC: mx, toleranceC: tol, coldChain: !!i.coldChain, active: i.active !== false, sortOrder: Math.round(i.sortOrder ?? 50) };
  const dup = await prisma.tempClass.findFirst({ where: { code, ...(i.id ? { id: { not: i.id } } : {}) } });
  if (dup) throw new ValidationError("A class with this code already exists.");
  const row = i.id ? await prisma.tempClass.update({ where: { id: i.id }, data }) : await prisma.tempClass.create({ data });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "coldchain.class_saved", entityType: "TempClass", entityId: row.id, after: data });
  return row;
}

/** FIRINGI: every category with its own class and the one it inherits. */
export async function categoryClasses(ctx: Ctx, locale: string) {
  if (!isStaff(ctx) || !can(ctx, ["admin.catalogue.view", "admin.catalogue.manage"])) throw new ForbiddenError();
  const rows = await prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true, depth: true, path: true, parentId: true, tempClassId: true }, orderBy: { path: "asc" } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows.map((r) => {
    let p = r.parentId ? byId.get(r.parentId) : undefined;
    while (p && !p.tempClassId) p = p.parentId ? byId.get(p.parentId) : undefined;
    return { id: r.id, name: pickLocalized(r.name as Record<string, string>, locale), depth: r.depth, tempClassId: r.tempClassId, inherited: r.tempClassId ? null : p?.tempClassId ?? null };
  });
}

export async function setCategoryClass(ctx: Ctx, categoryId: string, tempClassId: string | null) {
  if (!isStaff(ctx) || !can(ctx, "admin.catalogue.manage")) throw new ForbiddenError();
  if (tempClassId && !(await prisma.tempClass.findUnique({ where: { id: tempClassId } }))) throw new NotFoundError("Temperature class");
  const before = await prisma.category.findUniqueOrThrow({ where: { id: categoryId }, select: { tempClassId: true } });
  await prisma.category.update({ where: { id: categoryId }, data: { tempClassId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "coldchain.category_class", entityType: "Category", entityId: categoryId, before, after: { tempClassId } });
}

/** The class of each offer (supplier's choice, else the nearest category's). Ambient / none → null. */
export async function offerClasses(offerIds: string[], db: Tx | typeof prisma = prisma) {
  if (!offerIds.length) return new Map<string, string | null>();
  const rows = await db.vendorOffer.findMany({
    where: { id: { in: offerIds } },
    select: { id: true, tempClassId: true, packaging: { select: { variant: { select: { product: { select: { category: { select: { tempClassId: true, parent: { select: { tempClassId: true, parent: { select: { tempClassId: true } } } } } } } } } } } } },
  });
  return new Map(rows.map((r) => {
    const c = r.packaging.variant.product.category;
    return [r.id, effectiveClass(r.tempClassId, [c?.tempClassId, c?.parent?.tempClassId, c?.parent?.parent?.tempClassId])];
  }));
}

/** The class an offer would get from its category alone (what "from the category" means for the supplier). */
export async function categoryInheritance(offerIds: string[]) {
  if (!offerIds.length) return new Map<string, string | null>();
  const rows = await prisma.vendorOffer.findMany({
    where: { id: { in: offerIds } },
    select: { id: true, packaging: { select: { variant: { select: { product: { select: { category: { select: { tempClassId: true, parent: { select: { tempClassId: true, parent: { select: { tempClassId: true } } } } } } } } } } } } },
  });
  return new Map(rows.map((r) => { const c = r.packaging.variant.product.category; return [r.id, effectiveClass(null, [c?.tempClassId, c?.parent?.tempClassId, c?.parent?.parent?.tempClassId])]; }));
}

/** Supplier: its offers with the class they get (own choice or the category's). */
export async function vendorOfferClasses(ctx: Ctx, locale: string) {
  if (!can(ctx, ["vendor.products.manage", "vendor.products.view"])) throw new ForbiddenError();
  const offers = await prisma.vendorOffer.findMany({
    where: { vendorCompanyId: ctx.company.id, status: { not: "REJECTED" } },
    select: { id: true, vendorSku: true, tempClassId: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } }, orderBy: { createdAt: "asc" },
  });
  const eff = await offerClasses(offers.map((o) => o.id));
  return offers.map((o) => ({ id: o.id, sku: o.vendorSku, name: pickLocalized(o.packaging.variant.product.name as Record<string, string>, locale), packaging: pickLocalized(o.packaging.name as Record<string, string>, locale), own: o.tempClassId, effective: eff.get(o.id) ?? null }));
}

export async function setOfferClass(ctx: Ctx, offerId: string, tempClassId: string | null) {
  if (!can(ctx, "vendor.products.manage")) throw new ForbiddenError();
  const o = await prisma.vendorOffer.findFirst({ where: { id: offerId, vendorCompanyId: ctx.company.id }, select: { id: true, tempClassId: true } });
  if (!o) throw new NotFoundError("Product");
  if (tempClassId && !(await prisma.tempClass.findFirst({ where: { id: tempClassId, active: true } }))) throw new NotFoundError("Temperature class");
  await prisma.vendorOffer.update({ where: { id: o.id }, data: { tempClassId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "coldchain.offer_class", entityType: "VendorOffer", entityId: o.id, before: { tempClassId: o.tempClassId }, after: { tempClassId } });
}

/** Buyer pages: the cold-chain class of offers (product page / cards) — only chilled / frozen, not ambient. */
export async function offerColdBadges(offerIds: string[], locale: string) {
  const s = await coldChainSettings();
  if (!s.enabled) return new Map<string, { code: string; name: string; range: string }>();
  const eff = await offerClasses(offerIds);
  const ids = [...new Set([...eff.values()].filter((x): x is string => !!x))];
  const classes = await prisma.tempClass.findMany({ where: { id: { in: ids }, coldChain: true } });
  const m = new Map<string, { code: string; name: string; range: string }>();
  for (const [offerId, cid] of eff) {
    const c = classes.find((x) => x.id === cid);
    if (c) m.set(offerId, { code: c.code, name: pickLocalized(c.name as Record<string, string>, locale), range: rangeLabel(rangeOf(c)) });
  }
  return m;
}

// ── orders ──────────────────────────────────────────────────────────────────

/** At checkout: the order lines keep their temperature class (cold chain only). */
export async function attachToOrder(tx: Tx, orderId: string) {
  const s = await coldChainSettings(tx);
  if (!s.enabled) return 0;
  const lines = await tx.orderLine.findMany({ where: { orderId }, select: { id: true, offerId: true } });
  const eff = await offerClasses([...new Set(lines.map((l) => l.offerId))], tx);
  const cold = new Set((await tx.tempClass.findMany({ where: { coldChain: true }, select: { id: true } })).map((c) => c.id));
  let n = 0;
  for (const l of lines) {
    const c = eff.get(l.offerId);
    if (c && cold.has(c)) { await tx.orderLine.update({ where: { id: l.id }, data: { tempClassId: c } }); n++; }
  }
  return n;
}

/** The cold classes an order carries, with their lines. */
async function orderClassesTx(db: Tx | typeof prisma, orderId: string) {
  const lines = await db.orderLine.findMany({ where: { orderId, tempClassId: { not: null } }, select: { id: true, tempClassId: true, qtyOrdered: true, qtyConfirmed: true, qtyDelivered: true, productName: true, tempClass: true } });
  const m = new Map<string, { cls: NonNullable<(typeof lines)[number]["tempClass"]>; lines: typeof lines }>();
  for (const l of lines) {
    if (!l.tempClass) continue;
    const e = m.get(l.tempClass.id) ?? { cls: l.tempClass, lines: [] };
    e.lines.push(l);
    m.set(l.tempClass.id, e);
  }
  return m;
}

async function nextIncidentNumber(tx: Tx) {
  const year = new Date().getFullYear();
  const seq = await tx.$queryRaw<{ n: number }[]>`INSERT INTO "Sequence" (name, year, "nextValue") VALUES ('coldchain', ${year}, 2)
    ON CONFLICT (name, year) DO UPDATE SET "nextValue" = "Sequence"."nextValue" + 1 RETURNING "nextValue" - 1 AS n`;
  return `CC-${year}-${String(seq[0].n).padStart(6, "0")}`;
}

type Reading = { orderId: string; deliveryId?: string | null; companyId: string; classId: string; stage: TempStage; valueC: number; status: TempStatusValue; byUserId: string | null; vehicleId?: string | null; probe?: string | null; note?: string | null; accepted?: boolean | null };

async function addReading(tx: Tx, r: Reading) {
  return tx.tempReading.create({
    data: { orderId: r.orderId, deliveryId: r.deliveryId ?? null, companyId: r.companyId, tempClassId: r.classId, stage: r.stage, valueC: r.valueC.toFixed(1), status: r.status as TempStatus, byUserId: r.byUserId, vehicleId: r.vehicleId ?? null, probe: r.probe?.trim() || null, note: r.note?.trim() || null, accepted: r.accepted ?? null },
  });
}

type IncidentOut = { id: string; number: string; orderId: string; decision: string; classId: string; stage: TempStage; valueC: number };

async function addIncident(tx: Tx, i: { orderId: string; deliveryId?: string | null; readingId: string; classId: string; stage: TempStage; valueC: number; decision: "NOTED" | "ACCEPTED" | "REFUSED" | "BLOCKED"; fault?: string | null; lines?: { orderLineId: string; qty: number }[] }) {
  const o = await tx.order.findUniqueOrThrow({ where: { id: i.orderId }, select: { sellerCompanyId: true, buyerCompanyId: true, delivery: { select: { driverId: true } } } });
  const number = await nextIncidentNumber(tx);
  const row = await tx.coldIncident.create({
    data: { number, orderId: i.orderId, deliveryId: i.deliveryId ?? null, readingId: i.readingId, tempClassId: i.classId, stage: i.stage, valueC: i.valueC.toFixed(1), decision: i.decision, fault: i.fault ?? null, lines: i.lines ?? undefined, sellerId: o.sellerCompanyId, buyerId: o.buyerCompanyId, driverId: o.delivery?.driverId ?? null },
  });
  return { id: row.id, number, orderId: i.orderId, decision: i.decision, classId: i.classId, stage: i.stage, valueC: i.valueC } satisfies IncidentOut;
}

/** Breach alert to the supplier and FIRINGI (when FIRINGI's rule says so). */
async function alertIncidents(list: IncidentOut[]) {
  const s = await coldChainSettings();
  if (!s.actions.alert || !list.length) return;
  const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
  for (const i of list) {
    const o = await prisma.order.findUniqueOrThrow({ where: { id: i.orderId }, select: { number: true, sellerCompanyId: true } });
    const c = await prisma.tempClass.findUniqueOrThrow({ where: { id: i.classId } });
    const vars = { number: o.number, incident: i.number, temp: `${i.valueC.toFixed(1).replace(".", ",")} °C`, range: rangeLabel(rangeOf(c)), stage: i.stage, decision: i.decision };
    await notify("coldchain.breach", [{ companyId: o.sellerCompanyId, link: `/vendor/orders/${i.orderId}#cold-chain` }, ...(admin ? [{ companyId: admin.id, link: `/admin/orders/${i.orderId}#cold-chain` }] : [])], vars, { ref: { type: "ColdIncident", id: i.id } });
  }
}

const temps = (raw: Record<string, unknown> | null | undefined) => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (v == null || v === "") continue;
    const c = parseC(v as string | number);
    if (c == null) throw new ValidationError("Temperatures are between −60 and 80 °C.");
    out[k] = c;
  }
  return out;
};

/** Supplier records the temperature at dispatch (per class on the order). */
export async function recordDispatch(ctx: Ctx, orderId: string, raw: Record<string, unknown>, probe?: string | null) {
  const s = await coldChainSettings();
  if (!s.enabled || !s.record.supplierDispatch) throw new AppError("OFF", "Recording at dispatch is switched off.", 409);
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, sellerCompanyId: true } });
  if (!o) throw new NotFoundError("Order");
  const staff = isStaff(ctx) && can(ctx, "admin.orders.manage");
  if (!staff && (o.sellerCompanyId !== ctx.company.id || !can(ctx, ["vendor.orders.manage", "vendor.warehouse.pick", "vendor.inventory.manage"]))) throw new ForbiddenError();
  if (!["SUPPLIER_PROCESSING", "READY_FOR_PICKUP", "DISPATCHED"].includes(o.status)) throw new AppError("BAD_STATUS", "Temperatures at dispatch are recorded between confirmation and dispatch.", 409);
  return recordStage(o.id, "DISPATCH", temps(raw), { companyId: o.sellerCompanyId, userId: ctx.user.id, probe });
}

async function recordStage(orderId: string, stage: TempStage, values: Record<string, number>, who: { companyId: string; userId: string; probe?: string | null; deliveryId?: string | null; vehicleId?: string | null; accepted?: boolean | null }) {
  const classes = await orderClassesTx(prisma, orderId);
  if (!Object.keys(values).length) throw new ValidationError("Enter at least one temperature.");
  for (const k of Object.keys(values)) if (!classes.has(k)) throw new ValidationError("This order has no products of that temperature class.");
  const incidents = await prisma.$transaction(async (tx) => {
    const out: IncidentOut[] = [];
    for (const [cid, v] of Object.entries(values)) {
      const st = classify(v, rangeOf(classes.get(cid)!.cls));
      const r = await addReading(tx, { orderId, deliveryId: who.deliveryId, companyId: who.companyId, classId: cid, stage, valueC: v, status: st, byUserId: who.userId, vehicleId: who.vehicleId, probe: who.probe, accepted: who.accepted });
      if (st === "OUT") out.push(await addIncident(tx, { orderId, deliveryId: who.deliveryId, readingId: r.id, classId: cid, stage, valueC: v, decision: who.accepted === false ? "NOTED" : stage === "RECEIPT" ? "ACCEPTED" : "NOTED" }));
    }
    return out;
  });
  await alertIncidents(incidents);
  return { incidents: incidents.map((i) => i.number), statuses: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, classify(v, rangeOf(classes.get(k)!.cls))])) };
}

async function driverDelivery(ctx: Ctx, deliveryId: string) {
  const d = await prisma.delivery.findUnique({ where: { id: deliveryId }, select: { id: true, orderId: true, status: true, vehicleId: true, executingCompanyId: true, driver: { select: { userId: true } } } });
  if (!d) throw new NotFoundError("Delivery");
  if (d.driver?.userId !== ctx.user.id || !can(ctx, "driver.deliveries.update")) throw new ForbiddenError();
  return d;
}

/** Driver records the temperature when loading. */
export async function recordLoading(ctx: Ctx, deliveryId: string, raw: Record<string, unknown>, probe?: string | null) {
  const s = await coldChainSettings();
  if (!s.enabled || !s.record.driverLoading) throw new AppError("OFF", "Recording at loading is switched off.", 409);
  const d = await driverDelivery(ctx, deliveryId);
  if (!["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"].includes(d.status)) throw new AppError("BAD_STATUS", "This delivery is closed.", 409);
  return recordStage(d.orderId, "LOADING", temps(raw), { companyId: d.executingCompanyId, userId: ctx.user.id, probe, deliveryId: d.id, vehicleId: d.vehicleId });
}

export type HandoverResult = { incidents: IncidentOut[]; refused: { classId: string; decision: "REFUSED" | "BLOCKED"; lines: { orderLineId: string; qty: number }[] }[] };

/**
 * At the handover (inside the delivery transaction, before the order is DELIVERED): the driver's readings per
 * class, the classes the customer refuses. Out of range + FIRINGI's block rule → refused automatically. Refusing
 * everything isn't a delivery: the driver records a failed delivery (temperature) instead.
 */
export async function recordHandoverTx(tx: Tx, deliveryId: string, raw: Record<string, unknown> | null | undefined, refuse: string[] | null | undefined, userId: string): Promise<HandoverResult> {
  const s = await coldChainSettings(tx);
  const none: HandoverResult = { incidents: [], refused: [] };
  if (!s.enabled) return none;
  const d = await tx.delivery.findUniqueOrThrow({ where: { id: deliveryId }, select: { id: true, orderId: true, vehicleId: true, executingCompanyId: true, order: { select: { buyerCompanyId: true, lines: { select: { id: true } } } } } });
  const classes = await orderClassesTx(tx, d.orderId);
  if (!classes.size) return none;
  const values = s.record.driverHandover ? temps(raw) : {};
  if (s.requireHandover && s.record.driverHandover) for (const [cid, e] of classes) if (values[cid] == null) throw new ValidationError(`Record the temperature of the ${pickLocalized(e.cls.name as Record<string, string>, "en").toLowerCase()} products before the handover.`);
  const refusing = new Set((refuse ?? []).filter((c) => classes.has(c)));
  if (refusing.size && !s.actions.customerRefuse) throw new AppError("OFF", "Refusing goods for temperature is switched off.", 409);
  const out: HandoverResult = { incidents: [], refused: [] };
  const prior = await tx.tempReading.findMany({ where: { orderId: d.orderId, stage: { in: ["DISPATCH", "LOADING"] } }, orderBy: { at: "desc" } });
  for (const [cid, e] of classes) {
    const v = values[cid];
    const st = v != null ? classify(v, rangeOf(e.cls)) : null;
    const blocked = st === "OUT" && s.actions.block;
    const refused = blocked || refusing.has(cid);
    if (refusing.has(cid) && st !== "OUT" && st !== "WARN") throw new ValidationError("Goods can only be refused for temperature when the reading is out of range.");
    if (v != null) {
      const r = await addReading(tx, { orderId: d.orderId, deliveryId: d.id, companyId: d.executingCompanyId, classId: cid, stage: "HANDOVER", valueC: v, status: st!, byUserId: userId, vehicleId: d.vehicleId, accepted: !refused });
      if (st === "OUT" || refused) {
        const lines = refused ? e.lines.map((l) => ({ orderLineId: l.id, qty: l.qtyConfirmed ?? l.qtyOrdered })).filter((l) => l.qty > 0) : undefined;
        const dispatch = prior.find((p) => p.tempClassId === cid && p.stage === "DISPATCH")?.status ?? null;
        const loading = prior.find((p) => p.tempClassId === cid && p.stage === "LOADING")?.status ?? null;
        const ord = await tx.order.findUniqueOrThrow({ where: { id: d.orderId }, select: { deliveryMode: true } });
        const firingiFleet = ord.deliveryMode === "FIRINGI_FLEET" && (await tx.company.findUnique({ where: { id: d.executingCompanyId }, select: { type: true } }))?.type === "ADMIN";
        const fault = refused ? inferFault({ dispatch, loading, firingiFleet }) : null;
        out.incidents.push(await addIncident(tx, { orderId: d.orderId, deliveryId: d.id, readingId: r.id, classId: cid, stage: "HANDOVER", valueC: v, decision: blocked ? "BLOCKED" : refused ? "REFUSED" : "ACCEPTED", fault, lines }));
        if (refused && lines?.length) out.refused.push({ classId: cid, decision: blocked ? "BLOCKED" : "REFUSED", lines });
      }
    }
  }
  const refusedLines = new Set(out.refused.flatMap((r) => r.lines.map((l) => l.orderLineId)));
  if (refusedLines.size && refusedLines.size >= d.order.lines.length)
    throw new AppError("ALL_REFUSED", "Nothing can be handed over: record a failed delivery (temperature) and take the goods back.", 409);
  return out;
}

/** After the delivery is invoiced: refused goods → a temperature claim credited at once; alerts. */
export async function afterHandover(result: HandoverResult, userId: string) {
  if (!result.incidents.length) return;
  for (const r of result.refused) {
    const inc = result.incidents.find((i) => i.classId === r.classId && (i.decision === "REFUSED" || i.decision === "BLOCKED"));
    if (!inc) continue;
    const row = await prisma.coldIncident.findUniqueOrThrow({ where: { id: inc.id }, include: { tempClass: true } });
    const { systemTemperatureClaim } = await import("@/server/claims/service");
    const claim = await systemTemperatureClaim({
      orderId: row.orderId, lines: r.lines, fault: (row.fault ?? "SUPPLIER") as "SUPPLIER" | "DRIVER" | "FIRINGI", actorUserId: userId,
      description: `${r.decision === "BLOCKED" ? "Blocked" : "Refused"} at delivery: ${Number(row.valueC).toFixed(1).replace(".", ",")} °C (${pickLocalized(row.tempClass.name as Record<string, string>, "pt")}, ${rangeLabel(rangeOf(row.tempClass))}) — ${row.number}`,
    });
    if (claim) await prisma.coldIncident.update({ where: { id: inc.id }, data: { claimId: claim.id } });
  }
  await alertIncidents(result.incidents);
}

/** Customer records the temperature on receiving a FIRINGI order (HACCP receiving check). */
export async function recordReceipt(ctx: Ctx, orderId: string, raw: Record<string, unknown>, accepted = true, note?: string | null) {
  const s = await coldChainSettings();
  if (!s.enabled || !s.record.customerReceipt) throw new AppError("OFF", "Recording on receipt is switched off.", 409);
  if (!can(ctx, ["buyer.orders.place", "buyer.orders.view"])) throw new ForbiddenError();
  const o = await prisma.order.findFirst({ where: { id: orderId, buyerCompanyId: ctx.company.id }, select: { id: true, status: true } });
  if (!o) throw new NotFoundError("Order");
  if (o.status !== "DELIVERED") throw new AppError("BAD_STATUS", "Record the receiving temperature once the order is delivered.", 409);
  const r = await recordStage(o.id, "RECEIPT", temps(raw), { companyId: ctx.company.id, userId: ctx.user.id, accepted });
  if (note?.trim()) await prisma.tempReading.updateMany({ where: { orderId: o.id, stage: "RECEIPT", byUserId: ctx.user.id, note: null }, data: { note: note.trim().slice(0, 300) } });
  return r;
}

// ── receiving log (customer HACCP, incl. goods from outside FIRINGI) ────────

export async function addReceivingEntry(ctx: Ctx, i: { supplierName: string; product: string; tempClassId: string; valueC: unknown; accepted: boolean; note?: string | null }) {
  const s = await coldChainSettings();
  if (!s.enabled || !s.records.receivingLog) throw new AppError("OFF", "The receiving log is switched off.", 409);
  if (!can(ctx, ["buyer.orders.place", "buyer.orders.view"]) || ctx.company.type === "ADMIN") throw new ForbiddenError();
  const sup = i.supplierName.trim(), prod = i.product.trim();
  if (sup.length < 2 || prod.length < 2) throw new ValidationError("Enter the supplier and the product.");
  const c = await prisma.tempClass.findFirst({ where: { id: i.tempClassId, active: true } });
  if (!c) throw new NotFoundError("Temperature class");
  const v = parseC(i.valueC as string);
  if (v == null) throw new ValidationError("Temperatures are between −60 and 80 °C.");
  const st = classify(v, rangeOf(c));
  return prisma.tempReading.create({
    data: { companyId: ctx.company.id, tempClassId: c.id, stage: "RECEIPT", valueC: v.toFixed(1), status: st as TempStatus, supplierName: sup.slice(0, 120), product: prod.slice(0, 160), accepted: !!i.accepted, note: i.note?.trim().slice(0, 300) || null, byUserId: ctx.user.id },
  });
}

/** The customer's receiving log for a month: FIRINGI orders (receipt + handover) and outside deliveries. */
export async function receivingLog(ctx: Ctx, ym: string, locale: string) {
  if (!can(ctx, ["buyer.orders.place", "buyer.orders.view"])) throw new ForbiddenError();
  const range = monthRange(ym);
  if (!range) throw new ValidationError("Choose a month.");
  const rows = await prisma.tempReading.findMany({
    where: { at: { gte: range[0], lt: range[1] }, OR: [{ companyId: ctx.company.id, stage: "RECEIPT" }, { order: { buyerCompanyId: ctx.company.id }, stage: "HANDOVER" }] },
    include: { tempClass: true, order: { select: { number: true, seller: { select: { legalName: true, tradeName: true } } } } }, orderBy: { at: "asc" },
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.byUserId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  return rows.map((r) => ({
    id: r.id, at: r.at, stage: r.stage, order: r.order?.number ?? null, supplier: r.order ? cname(r.order.seller) : r.supplierName, product: r.product,
    cls: r.tempClass ? pickLocalized(r.tempClass.name as Record<string, string>, locale) : "", range: r.tempClass ? rangeLabel(rangeOf(r.tempClass)) : "", valueC: Number(r.valueC), status: r.status, accepted: r.accepted, note: r.note,
    by: users.find((u) => u.id === r.byUserId)?.name ?? null,
  }));
}

// ── loggers ─────────────────────────────────────────────────────────────────

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const fleetOwner = (ctx: Ctx) => {
  if (isStaff(ctx) && can(ctx, ["admin.fleet.manage", "admin.delivery.manage"])) return ctx.company.id;
  if (!isStaff(ctx) && can(ctx, ["vendor.vehicles.manage", "vendor.inventory.manage"])) return ctx.company.id;
  throw new ForbiddenError();
};
const fleetViewer = (ctx: Ctx) => {
  if (isStaff(ctx) && can(ctx, ["admin.fleet.view", "admin.fleet.manage", "admin.delivery.view"])) return ctx.company.id;
  if (!isStaff(ctx) && can(ctx, ["vendor.fleet.view", "vendor.vehicles.manage", "vendor.inventory.view", "vendor.inventory.manage"])) return ctx.company.id;
  throw new ForbiddenError();
};

/** A new logger — the token is shown once (the device sends it as "Authorization: Bearer …"). */
export async function createLogger(ctx: Ctx, i: { name: string; serial?: string | null; vehicleId?: string | null; equipmentId?: string | null; tempClassId?: string | null }) {
  const owner = fleetOwner(ctx);
  if (!i.name.trim()) throw new ValidationError("Give the logger a name.");
  if (i.vehicleId && !(await prisma.vehicle.findFirst({ where: { id: i.vehicleId, ownerCompanyId: owner } }))) throw new NotFoundError("Vehicle");
  if (i.equipmentId && !(await prisma.coldEquipment.findFirst({ where: { id: i.equipmentId, ownerCompanyId: owner } }))) throw new NotFoundError("Equipment");
  const token = `fcl_${randomBytes(24).toString("base64url")}`;
  const row = await prisma.tempLogger.create({ data: { ownerCompanyId: owner, name: i.name.trim().slice(0, 80), serial: i.serial?.trim() || null, vehicleId: i.vehicleId || null, equipmentId: i.equipmentId || null, tempClassId: i.tempClassId || null, tokenHash: hash(token), tokenHint: token.slice(-4) } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "coldchain.logger_created", entityType: "TempLogger", entityId: row.id, after: { name: row.name, vehicleId: row.vehicleId } });
  return { id: row.id, token };
}

export async function setLoggerActive(ctx: Ctx, id: string, active: boolean) {
  const owner = fleetOwner(ctx);
  const r = await prisma.tempLogger.updateMany({ where: { id, ownerCompanyId: owner }, data: { active } });
  if (!r.count) throw new NotFoundError("Logger");
}

/** Readings pushed by a logger (API). Returns how many were stored; raises an alert when out of range too long. */
export async function ingestReadings(token: string, raw: unknown) {
  const s = await coldChainSettings();
  if (!s.enabled || !s.record.loggers) throw new AppError("OFF", "Temperature loggers are switched off.", 403);
  const lg = await prisma.tempLogger.findUnique({ where: { tokenHash: hash(token) }, include: { tempClass: true } });
  if (!lg || !lg.active) throw new AppError("UNAUTHORIZED", "Unknown or inactive logger.", 401);
  const list = (Array.isArray(raw) ? raw : (raw as { readings?: unknown[] })?.readings ?? [raw]) as { at?: string; value?: unknown; valueC?: unknown; temp?: unknown }[];
  if (!list.length || list.length > 1000) throw new ValidationError("Send 1 to 1000 readings.");
  const now = Date.now();
  const rows: { at: Date; valueC: number }[] = [];
  for (const x of list) {
    const v = parseC((x.valueC ?? x.value ?? x.temp) as string);
    const at = x.at ? new Date(x.at) : new Date();
    if (v == null || Number.isNaN(at.getTime()) || at.getTime() > now + 5 * 60_000 || at.getTime() < now - 31 * 86_400_000) throw new ValidationError("Each reading needs a temperature (−60 to 80 °C) and a time within the last 31 days.");
    rows.push({ at, valueC: v });
  }
  const res = await prisma.tempLoggerReading.createMany({ data: rows.map((r) => ({ loggerId: lg.id, at: r.at, valueC: r.valueC.toFixed(1) })), skipDuplicates: true });
  const newest = rows.reduce((a, r) => (r.at > a.at ? r : a), rows[0]);
  if (!lg.lastSeenAt || newest.at >= lg.lastSeenAt) await prisma.tempLogger.update({ where: { id: lg.id }, data: { lastSeenAt: newest.at, lastValueC: newest.valueC.toFixed(1) } });
  if (lg.tempClass) await checkLogger(lg.id, s);
  return { stored: res.count };
}

/** A logger out of range for the alert time → one alert per hour to its owner and FIRINGI. */
async function checkLogger(loggerId: string, s: ColdChainSettings) {
  const lg = await prisma.tempLogger.findUniqueOrThrow({ where: { id: loggerId }, include: { tempClass: true } });
  if (!lg.tempClass || !s.actions.alert) return false;
  const recent = await prisma.tempLoggerReading.findMany({ where: { loggerId, at: { gte: new Date(Date.now() - 6 * 3600_000) } }, orderBy: { at: "desc" }, take: 500 });
  const mins = minutesOutNow(recent.map((r) => ({ at: r.at, valueC: Number(r.valueC) })), rangeOf(lg.tempClass));
  if (mins < s.loggerAlertMinutes || (lg.alertedAt && Date.now() - lg.alertedAt.getTime() < 3600_000)) return false;
  await prisma.tempLogger.update({ where: { id: lg.id }, data: { alertedAt: new Date() } });
  const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
  const vars = { logger: lg.name, minutes: mins, temp: `${Number(recent[0].valueC).toFixed(1).replace(".", ",")} °C`, range: rangeLabel(rangeOf(lg.tempClass)) };
  const owner = await prisma.company.findUniqueOrThrow({ where: { id: lg.ownerCompanyId }, select: { type: true } });
  await notify("coldchain.logger_alert", [{ companyId: lg.ownerCompanyId, link: owner.type === "ADMIN" ? "/admin/delivery/cold-chain" : "/vendor/fleet/cold-chain" }, ...(admin && admin.id !== lg.ownerCompanyId ? [{ companyId: admin.id, link: "/admin/delivery/cold-chain" }] : [])], vars, { ref: { type: "TempLogger", id: lg.id } });
  return true;
}

/** Logger readings of the delivery's vehicle during the trip (pickup → handover). */
async function tripFor(deliveryId: string | null | undefined, classRange: TempRange | null) {
  if (!deliveryId) return null;
  const d = await prisma.delivery.findUnique({ where: { id: deliveryId }, select: { vehicleId: true, pickedUpAt: true, completedAt: true } });
  if (!d?.vehicleId || !d.pickedUpAt) return null;
  const loggers = await prisma.tempLogger.findMany({ where: { vehicleId: d.vehicleId }, select: { id: true, name: true, tempClass: true } });
  if (!loggers.length) return null;
  const rows = await prisma.tempLoggerReading.findMany({ where: { loggerId: { in: loggers.map((l) => l.id) }, at: { gte: d.pickedUpAt, lte: d.completedAt ?? new Date() } }, orderBy: { at: "asc" }, take: 2000 });
  const r = loggers[0].tempClass ? rangeOf(loggers[0].tempClass) : classRange;
  const stats = tripStats(rows.map((x) => ({ at: x.at, valueC: Number(x.valueC) })), r);
  return stats ? { logger: loggers.map((l) => l.name).join(", "), ...stats, points: rows.map((x) => ({ at: x.at, valueC: Number(x.valueC) })) } : null;
}

// ── equipment ───────────────────────────────────────────────────────────────

export type EquipmentInput = { id?: string | null; kind: ColdEquipmentKind; name: string; vehicleId?: string | null; tempClassId?: string | null; serial?: string | null; checkEveryDays?: number | null; cleanEveryDays?: number | null; calibrateEveryDays?: number | null; active?: boolean };

export async function saveEquipment(ctx: Ctx, i: EquipmentInput) {
  const owner = fleetOwner(ctx);
  const s = await coldChainSettings();
  if (!s.records.equipment) throw new AppError("OFF", "Equipment logs are switched off.", 409);
  if (!["VEHICLE_UNIT", "COLD_ROOM", "FREEZER", "PROBE"].includes(i.kind)) throw new ValidationError("Choose the kind of equipment.");
  if (!i.name.trim()) throw new ValidationError("Give it a name.");
  const days = (v: unknown, label: string) => {
    if (v == null || v === "" || v === 0) return null;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 1 || n > 730) throw new ValidationError(`${label} must be between 1 and 730 days.`);
    return n;
  };
  if (i.vehicleId && !(await prisma.vehicle.findFirst({ where: { id: i.vehicleId, ownerCompanyId: owner } }))) throw new NotFoundError("Vehicle");
  const data = {
    ownerCompanyId: owner, kind: i.kind, name: i.name.trim().slice(0, 80), vehicleId: i.vehicleId || null, tempClassId: i.tempClassId || null, serial: i.serial?.trim() || null,
    checkEveryDays: days(i.checkEveryDays, "Checks"), cleanEveryDays: days(i.cleanEveryDays, "Cleaning"), calibrateEveryDays: days(i.calibrateEveryDays, "Calibration"), active: i.active !== false,
  };
  if (i.id) {
    const r = await prisma.coldEquipment.updateMany({ where: { id: i.id, ownerCompanyId: owner }, data });
    if (!r.count) throw new NotFoundError("Equipment");
    return prisma.coldEquipment.findUniqueOrThrow({ where: { id: i.id } });
  }
  return prisma.coldEquipment.create({ data });
}

export async function addEquipmentLog(ctx: Ctx, equipmentId: string, i: { kind: EquipmentLogKind; ok: boolean; valueC?: unknown; note?: string | null }) {
  const owner = fleetViewer(ctx);
  const e = await prisma.coldEquipment.findFirst({ where: { id: equipmentId, ownerCompanyId: owner } });
  if (!e) throw new NotFoundError("Equipment");
  if (!["CHECK", "CLEANING", "CALIBRATION", "SERVICE"].includes(i.kind)) throw new ValidationError("Choose what was done.");
  const v = i.valueC == null || i.valueC === "" ? null : parseC(i.valueC as string);
  if (i.valueC != null && i.valueC !== "" && v == null) throw new ValidationError("Temperatures are between −60 and 80 °C.");
  const note = i.note?.trim() || null;
  if (!i.ok && (!note || note.length < 3)) throw new ValidationError("Say what was wrong.");
  const row = await prisma.equipmentLog.create({ data: { equipmentId: e.id, kind: i.kind, ok: !!i.ok, valueC: v == null ? null : v.toFixed(1), note, byUserId: ctx.user.id } });
  await prisma.coldEquipment.update({ where: { id: e.id }, data: { remindedAt: null } });
  return row;
}

type EqRow = Prisma.ColdEquipmentGetPayload<{ include: { logs: true; tempClass: true } }>;
function dueOf(e: EqRow, now = new Date()) {
  const last = (k: EquipmentLogKind) => e.logs.filter((l) => l.kind === k).sort((a, b) => b.doneAt.getTime() - a.doneAt.getTime())[0]?.doneAt ?? null;
  const items = ([["CHECK", e.checkEveryDays], ["CLEANING", e.cleanEveryDays], ["CALIBRATION", e.calibrateEveryDays]] as const)
    .map(([k, every]) => ({ kind: k, every, last: last(k), due: nextDue(last(k), every, e.createdAt) }))
    .filter((x) => x.due);
  return items.map((x) => ({ ...x, overdue: x.due! < now }));
}

export async function listEquipment(ctx: Ctx, locale: string) {
  const owner = fleetViewer(ctx);
  const [rows, vehicles, loggers] = await Promise.all([
    prisma.coldEquipment.findMany({ where: { ownerCompanyId: owner }, include: { logs: { orderBy: { doneAt: "desc" }, take: 20 }, tempClass: true }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    prisma.vehicle.findMany({ where: { ownerCompanyId: owner }, select: { id: true, plate: true, isRefrigerated: true }, orderBy: { plate: "asc" } }),
    prisma.tempLogger.findMany({ where: { ownerCompanyId: owner }, include: { tempClass: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => r.logs.map((l) => l.byUserId)).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const s = await coldChainSettings();
  return {
    settings: { equipment: s.records.equipment, loggers: s.record.loggers },
    vehicles: vehicles.map((v) => ({ id: v.id, label: v.plate, refrigerated: v.isRefrigerated })),
    equipment: rows.map((e) => ({
      id: e.id, kind: e.kind, name: e.name, serial: e.serial, active: e.active, vehicle: vehicles.find((v) => v.id === e.vehicleId)?.plate ?? null, vehicleId: e.vehicleId,
      cls: e.tempClass ? pickLocalized(e.tempClass.name as Record<string, string>, locale) : null, tempClassId: e.tempClassId,
      checkEveryDays: e.checkEveryDays, cleanEveryDays: e.cleanEveryDays, calibrateEveryDays: e.calibrateEveryDays, due: dueOf(e),
      logs: e.logs.map((l) => ({ id: l.id, kind: l.kind, ok: l.ok, valueC: num(l.valueC), note: l.note, doneAt: l.doneAt, by: users.find((u) => u.id === l.byUserId)?.name ?? null })),
    })),
    loggers: loggers.map((l) => ({
      id: l.id, name: l.name, serial: l.serial, active: l.active, hint: l.tokenHint, vehicle: vehicles.find((v) => v.id === l.vehicleId)?.plate ?? null,
      cls: l.tempClass ? pickLocalized(l.tempClass.name as Record<string, string>, locale) : null, lastSeenAt: l.lastSeenAt, lastValueC: num(l.lastValueC),
      status: l.tempClass && l.lastValueC != null ? classify(Number(l.lastValueC), rangeOf(l.tempClass)) : null,
    })),
  };
}

// ── order views & documents ─────────────────────────────────────────────────

export type ColdView = "BUYER" | "SUPPLIER" | "ADMIN" | "DRIVER";

/** The cold-chain card of an order: classes, readings per stage, incidents, what this viewer may record. */
export async function orderColdChain(ctx: Ctx, orderId: string, as: ColdView, locale: string) {
  const s = await coldChainSettings();
  if (!s.enabled) return null;
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, number: true, status: true, buyerCompanyId: true, sellerCompanyId: true, delivery: { select: { id: true, status: true, driver: { select: { userId: true } } } } } });
  if (!o) throw new NotFoundError("Order");
  if (as === "BUYER" && o.buyerCompanyId !== ctx.company.id) throw new ForbiddenError();
  if (as === "SUPPLIER" && o.sellerCompanyId !== ctx.company.id) throw new ForbiddenError();
  if (as === "ADMIN" && !isStaff(ctx)) throw new ForbiddenError();
  if (as === "DRIVER" && o.delivery?.driver?.userId !== ctx.user.id) throw new ForbiddenError();
  const classes = await orderClassesTx(prisma, orderId);
  if (!classes.size) return null;
  const [readings, incidents] = await Promise.all([
    prisma.tempReading.findMany({ where: { orderId }, orderBy: { at: "asc" } }),
    prisma.coldIncident.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } }),
  ]);
  const claims = await prisma.qualityClaim.findMany({ where: { id: { in: incidents.map((i) => i.claimId).filter((x): x is string => !!x) } }, select: { id: true, number: true, creditGross: true } });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(readings.map((r) => r.byUserId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const firstCls = [...classes.values()][0].cls;
  const trip = s.record.loggers && as !== "BUYER" ? await tripFor(o.delivery?.id, rangeOf(firstCls)) : null;
  const delivered = o.status === "DELIVERED";
  return {
    settings: { record: s.record, actions: s.actions, records: s.records },
    classes: [...classes.values()].map((e) => ({
      id: e.cls.id, code: e.cls.code, name: pickLocalized(e.cls.name as Record<string, string>, locale), range: rangeLabel(rangeOf(e.cls)),
      products: e.lines.map((l) => pickLocalized(l.productName as Record<string, string>, locale)),
      readings: readings.filter((r) => r.tempClassId === e.cls.id).map((r) => ({ id: r.id, stage: r.stage, valueC: Number(r.valueC), status: r.status, at: r.at, accepted: r.accepted, probe: r.probe, by: users.find((u) => u.id === r.byUserId)?.name ?? null })),
    })),
    incidents: incidents.map((i) => ({ id: i.id, number: i.number, stage: i.stage, valueC: Number(i.valueC), decision: i.decision, fault: as === "BUYER" ? null : i.fault, at: i.createdAt, claim: claims.find((c) => c.id === i.claimId) ? { id: i.claimId!, number: claims.find((c) => c.id === i.claimId)!.number } : null, cls: classes.get(i.tempClassId)?.cls ? pickLocalized(classes.get(i.tempClassId)!.cls.name as Record<string, string>, locale) : "" })),
    trip: trip ? { ...trip, points: trip.points.slice(-300) } : null,
    can: {
      dispatch: (as === "SUPPLIER" || as === "ADMIN") && s.record.supplierDispatch && ["SUPPLIER_PROCESSING", "READY_FOR_PICKUP", "DISPATCHED"].includes(o.status),
      loading: as === "DRIVER" && s.record.driverLoading && !!o.delivery && ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"].includes(o.delivery.status),
      receipt: as === "BUYER" && s.record.customerReceipt && delivered,
      certificate: s.records.certificate && delivered && as !== "DRIVER",
    },
  };
}

/** Data for the delivery temperature certificate (PDF). */
export async function certificateData(ctx: Ctx, orderId: string) {
  const s = await coldChainSettings();
  if (!s.enabled || !s.records.certificate) throw new AppError("OFF", "Temperature certificates are switched off.", 409);
  const as: ColdView = isStaff(ctx) ? "ADMIN" : (await prisma.order.findFirst({ where: { id: orderId, sellerCompanyId: ctx.company.id }, select: { id: true } })) ? "SUPPLIER" : "BUYER";
  const v = await orderColdChain(ctx, orderId, as, "pt");
  if (!v) throw new NotFoundError("Cold-chain record");
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { number: true, placedAt: true, deliveryAddress: true, buyer: { select: { legalName: true, vatNumber: true } }, seller: { select: { legalName: true, vatNumber: true } }, delivery: { select: { completedAt: true, vehicle: { select: { plate: true } }, driver: { select: { user: { select: { name: true } } } } } } } });
  const trip = s.record.loggers ? await tripFor((await prisma.delivery.findUnique({ where: { orderId }, select: { id: true } }))?.id, null) : null;
  const a = o.deliveryAddress as Record<string, string | null>;
  return {
    number: o.number, deliveredAt: o.delivery?.completedAt ?? null, supplier: `${o.seller.legalName}${o.seller.vatNumber ? ` · ${o.seller.vatNumber}` : ""}`, customer: `${o.buyer.legalName}${o.buyer.vatNumber ? ` · ${o.buyer.vatNumber}` : ""}`,
    address: [a.line1, [a.postalCode, a.city].filter(Boolean).join(" ")].filter(Boolean).join(", "), vehicle: o.delivery?.vehicle?.plate ?? null, driver: o.delivery?.driver?.user.name ?? null,
    classes: v.classes, incidents: v.incidents, trip: trip ? { logger: trip.logger, minC: trip.minC, maxC: trip.maxC, avgC: trip.avgC, minutesOut: trip.minutesOut, from: trip.from, to: trip.to, count: trip.count } : null,
  };
}

/** Monthly HACCP report: every reading of the company's orders (and the customer's receiving log). */
export async function monthlyReport(ctx: Ctx, ym: string, locale: string) {
  const s = await coldChainSettings();
  if (!s.enabled || !s.records.monthly) throw new AppError("OFF", "Monthly reports are switched off.", 409);
  const range = monthRange(ym);
  if (!range) throw new ValidationError("Choose a month (YYYY-MM).");
  const me = ctx.company.id;
  const side = isStaff(ctx) ? "ADMIN" : ctx.company.type === "DISTRIBUTOR" || ctx.company.type === "WHOLESALER" ? (can(ctx, ["vendor.orders.view", "vendor.orders.manage"]) ? "SUPPLIER" : "BUYER") : "BUYER";
  if (side === "ADMIN" && !can(ctx, ["admin.orders.view", "admin.orders.manage"])) throw new ForbiddenError();
  const where: Prisma.TempReadingWhereInput = { at: { gte: range[0], lt: range[1] }, ...(side === "ADMIN" ? {} : side === "SUPPLIER" ? { order: { sellerCompanyId: me } } : { OR: [{ order: { buyerCompanyId: me } }, { companyId: me, orderId: null }] }) };
  const rows = await prisma.tempReading.findMany({ where, include: { tempClass: true, order: { select: { number: true, buyer: { select: { legalName: true, tradeName: true } }, seller: { select: { legalName: true, tradeName: true } } } } }, orderBy: { at: "asc" }, take: 20_000 });
  const company = await prisma.company.findUniqueOrThrow({ where: { id: me }, select: { legalName: true, vatNumber: true } });
  const incidents = await prisma.coldIncident.count({ where: { createdAt: { gte: range[0], lt: range[1] }, ...(side === "ADMIN" ? {} : side === "SUPPLIER" ? { sellerId: me } : { buyerId: me }) } });
  return {
    month: ym, company: company.legalName, vat: company.vatNumber, side, incidents,
    rows: rows.map((r) => ({
      at: r.at, order: r.order?.number ?? "", counterpart: r.order ? cname(side === "SUPPLIER" ? r.order.buyer : r.order.seller) : r.supplierName ?? "", product: r.product ?? "",
      stage: r.stage, cls: r.tempClass ? pickLocalized(r.tempClass.name as Record<string, string>, locale) : "", range: r.tempClass ? rangeLabel(rangeOf(r.tempClass)) : "", valueC: Number(r.valueC), status: r.status, accepted: r.accepted,
    })),
  };
}

export function reportCsv(r: Awaited<ReturnType<typeof monthlyReport>>) {
  const q = (v: unknown) => { const s = v == null ? "" : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["date", "time", "order", "counterpart", "product", "stage", "class", "range", "temperature_c", "status", "accepted"];
  return [head.join(";"), ...r.rows.map((x) => [x.at.toISOString().slice(0, 10), x.at.toISOString().slice(11, 16), x.order, x.counterpart, x.product, x.stage, x.cls, x.range, x.valueC.toFixed(1).replace(".", ","), x.status, x.accepted == null ? "" : x.accepted ? "yes" : "no"].map(q).join(";"))].join("\n");
}

// ── overview & scores ───────────────────────────────────────────────────────

/** Breaches (incidents) per supplier and per FIRINGI driver, last `days` days — for scores. */
export async function breachCounts(days = 30, sellerId?: string) {
  const since = new Date(Date.now() - days * 86_400_000);
  const [bySeller, byDriver] = await Promise.all([
    prisma.coldIncident.groupBy({ by: ["sellerId"], where: { createdAt: { gte: since }, ...(sellerId ? { sellerId } : {}) }, _count: true }),
    prisma.coldIncident.groupBy({ by: ["driverId"], where: { createdAt: { gte: since }, driverId: { not: null }, fault: "DRIVER" }, _count: true }),
  ]);
  return { bySeller: new Map(bySeller.map((r) => [r.sellerId, r._count])), byDriver: new Map(byDriver.map((r) => [r.driverId!, r._count])) };
}

/** FIRINGI (or a supplier for its own): incidents, breaches per supplier / driver / class, loggers, equipment due. */
export async function coldOverview(ctx: Ctx, locale: string, days = 30) {
  const staff = isStaff(ctx);
  if (staff ? !can(ctx, ["admin.orders.view", "admin.delivery.view", "admin.fleet.view"]) : !can(ctx, ["vendor.orders.view", "vendor.orders.manage"])) throw new ForbiddenError();
  const since = new Date(Date.now() - days * 86_400_000);
  const scope: Prisma.ColdIncidentWhereInput = { createdAt: { gte: since }, ...(staff ? {} : { sellerId: ctx.company.id }) };
  const [incidents, readings, byDecision, classes] = await Promise.all([
    prisma.coldIncident.findMany({ where: scope, include: { order: { select: { number: true } }, tempClass: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.tempReading.groupBy({ by: ["status"], where: { at: { gte: since }, orderId: { not: null }, ...(staff ? {} : { order: { sellerCompanyId: ctx.company.id } }) }, _count: true }),
    prisma.coldIncident.groupBy({ by: ["decision"], where: scope, _count: true }),
    listClasses(locale),
  ]);
  const companies = await prisma.company.findMany({ where: { id: { in: [...new Set(incidents.flatMap((i) => [i.sellerId, i.buyerId]))] } }, select: { id: true, legalName: true, tradeName: true } });
  const drivers = await prisma.driver.findMany({ where: { id: { in: [...new Set(incidents.map((i) => i.driverId).filter((x): x is string => !!x))] } }, select: { id: true, user: { select: { name: true } } } });
  const s = await coldChainSettings();
  const perSupplier = new Map<string, { name: string; incidents: number; refused: number }>();
  const perDriver = new Map<string, { name: string; incidents: number }>();
  for (const i of incidents) {
    const sup = perSupplier.get(i.sellerId) ?? { name: cname(companies.find((c) => c.id === i.sellerId)), incidents: 0, refused: 0 };
    sup.incidents++; if (i.decision === "REFUSED" || i.decision === "BLOCKED") sup.refused++;
    perSupplier.set(i.sellerId, sup);
    if (i.driverId && i.fault === "DRIVER") { const d = perDriver.get(i.driverId) ?? { name: drivers.find((x) => x.id === i.driverId)?.user.name ?? "", incidents: 0 }; d.incidents++; perDriver.set(i.driverId, d); }
  }
  const total = readings.reduce((a, r) => a + r._count, 0);
  const eqOwner = staff ? ctx.company.id : ctx.company.id;
  const eq = await prisma.coldEquipment.findMany({ where: { ownerCompanyId: eqOwner, active: true }, include: { logs: true, tempClass: true } });
  const loggers = await prisma.tempLogger.findMany({ where: staff ? {} : { ownerCompanyId: ctx.company.id }, include: { tempClass: true } });
  return {
    days, settings: s, classes,
    totals: {
      readings: total, ok: readings.find((r) => r.status === "OK")?._count ?? 0, warn: readings.find((r) => r.status === "WARN")?._count ?? 0, out: readings.find((r) => r.status === "OUT")?._count ?? 0,
      incidents: incidents.length, refused: (byDecision.find((d) => d.decision === "REFUSED")?._count ?? 0) + (byDecision.find((d) => d.decision === "BLOCKED")?._count ?? 0),
      equipmentOverdue: eq.filter((e) => dueOf(e).some((d) => d.overdue)).length, loggers: loggers.length,
      loggersOut: loggers.filter((l) => l.tempClass && l.lastValueC != null && classify(Number(l.lastValueC), rangeOf(l.tempClass)) === "OUT").length,
    },
    incidents: incidents.map((i) => ({ id: i.id, number: i.number, orderId: i.orderId, order: i.order.number, stage: i.stage, valueC: Number(i.valueC), decision: i.decision, fault: i.fault, at: i.createdAt, cls: pickLocalized(i.tempClass.name as Record<string, string>, locale), range: rangeLabel(rangeOf(i.tempClass)), supplier: cname(companies.find((c) => c.id === i.sellerId)), customer: cname(companies.find((c) => c.id === i.buyerId)), claimId: i.claimId })),
    suppliers: [...perSupplier.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.incidents - a.incidents),
    drivers: [...perDriver.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.incidents - a.incidents),
  };
}

// ── daily job ───────────────────────────────────────────────────────────────

/** Equipment checks / cleaning / calibration due → reminder to the owner (once a week per item); loggers re-checked. */
export async function runColdChainJob(now = new Date()) {
  const s = await coldChainSettings();
  if (!s.enabled) return { reminders: 0, loggerAlerts: 0 };
  let reminders = 0, loggerAlerts = 0;
  if (s.records.equipment) {
    const eq = await prisma.coldEquipment.findMany({ where: { active: true }, include: { logs: true, tempClass: true } });
    for (const e of eq) {
      const over = dueOf(e, now).filter((d) => d.overdue);
      if (!over.length || (e.remindedAt && now.getTime() - e.remindedAt.getTime() < 7 * 86_400_000)) continue;
      const owner = await prisma.company.findUniqueOrThrow({ where: { id: e.ownerCompanyId }, select: { type: true } });
      await notify("coldchain.equipment_due", [{ companyId: e.ownerCompanyId, link: owner.type === "ADMIN" ? "/admin/delivery/cold-chain" : "/vendor/fleet/cold-chain" }], { equipment: e.name, tasks: over.map((o) => o.kind.toLowerCase()).join(", ") }, { ref: { type: "ColdEquipment", id: e.id } });
      await prisma.coldEquipment.update({ where: { id: e.id }, data: { remindedAt: now } });
      reminders++;
    }
  }
  if (s.record.loggers) {
    const lgs = await prisma.tempLogger.findMany({ where: { active: true, tempClassId: { not: null }, lastSeenAt: { gte: new Date(now.getTime() - 6 * 3600_000) } }, select: { id: true } });
    for (const l of lgs) if (await checkLogger(l.id, s)) loggerAlerts++;
  }
  return { reminders, loggerAlerts };
}

/** For driver data (offline app): the cold classes of a delivery to record. */
export async function stopClasses(orderId: string, locale: string) {
  const s = await coldChainSettings();
  if (!s.enabled) return { record: { loading: false, handover: false }, refuse: false, block: false, required: false, classes: [] as { id: string; name: string; range: string; minC: number | null; maxC: number | null; toleranceC: number; loaded: number | null }[] };
  const classes = await orderClassesTx(prisma, orderId);
  const loads = await prisma.tempReading.findMany({ where: { orderId, stage: "LOADING" }, orderBy: { at: "desc" } });
  return {
    record: { loading: s.record.driverLoading, handover: s.record.driverHandover }, refuse: s.actions.customerRefuse, block: s.actions.block, required: s.requireHandover,
    classes: [...classes.values()].map((e) => ({ id: e.cls.id, name: pickLocalized(e.cls.name as Record<string, string>, locale), range: rangeLabel(rangeOf(e.cls)), ...rangeOf(e.cls), loaded: num(loads.find((l) => l.tempClassId === e.cls.id)?.valueC) })),
  };
}
