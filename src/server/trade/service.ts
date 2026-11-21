import "server-only";
/**
 * EU trade reporting (Phase 57). Rules and file layouts in src/lib/trade.ts; docs in docs/eu-trade.md.
 *
 * FIRINGI invoices every buyer and buys from every supplier, so FIRINGI's entity is the one that reports:
 *   - EC Sales List: FIRINGI's exempt intra-EU supplies (goods) and reverse-charge services to other EU countries;
 *   - Intrastat arrivals: goods FIRINGI bought from a supplier in another EU country (reverse-charge statements);
 *   - Intrastat dispatches: goods FIRINGI sold into another EU country (exempt intra-EU supply invoices).
 * Lines are rebuilt from the issued documents until FIRINGI files the period; credit notes after that become
 * correction lines in the next return. Suppliers download their own lines (what FIRINGI bought from them).
 * Before invoicing without VAT, the buyer's VAT number is checked at VIES (proof kept); not valid → local VAT.
 */
import Decimal from "decimal.js";
import type { Prisma, TradeReturnKind, TradeReturnStatus } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { checkVies, type ViesResult } from "@/server/services/vies";
import { pickLocalized } from "@/i18n/config";
import {
  BLOCKING, checkTradeSettings, countrySettings, daysUntil, dueOn, frequencyOf, genericTable, isPeriod, mergeTradeSettings, nationalFile, nextPeriod, normaliseCn,
  periodOf, periodRange, vatWithPrefix, type Declarant, type FileOut, type Indicator, type Problem, type TradeKind, type TradeLine, type TradeSettings,
} from "@/lib/trade";

const KEY = "trade.settings";
const WARNED = "trade.thresholdWarned";
const D = (v: { toString(): string } | number | null | undefined) => new Decimal(v == null ? 0 : v.toString());
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const isStaff = (ctx: Ctx) => ctx.company.type === "ADMIN";
const VIEW = ["admin.finance.view", "admin.finance.manage", "admin.tax.manage", "admin.invoices.view"] as const;
const MANAGE = ["admin.tax.manage", "admin.finance.manage"] as const;
const CODES = ["admin.catalogue.manage", "admin.tax.manage"] as const;
const cname = (c: { legalName: string; tradeName: string | null } | null | undefined) => (c ? c.tradeName ?? c.legalName : "");
const pick = (v: unknown) => pickLocalized((v ?? {}) as Record<string, string>, "en");
async function firingiId() { return (await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" }, select: { id: true } })).id; }

function staffOnly(ctx: Ctx, manage: boolean) {
  if (!isStaff(ctx) || !can(ctx, manage ? [...MANAGE] : [...VIEW, ...MANAGE])) throw new ForbiddenError();
}

// ── settings ──

export async function tradeSettings(db: Tx | typeof prisma = prisma): Promise<TradeSettings> {
  const row = await db.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeTradeSettings(row?.value);
}

export async function saveTradeSettings(ctx: Ctx, input: TradeSettings) {
  if (!isStaff(ctx) || !can(ctx, ["admin.settings.manage", "admin.tax.manage"])) throw new ForbiddenError();
  const problem = checkTradeSettings(input);
  const s = mergeTradeSettings(input);
  if (problem) throw new ValidationError(problem);
  const before = await tradeSettings();
  const existing = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (existing) await prisma.setting.update({ where: { id: existing.id }, data: { value: s as unknown as Prisma.InputJsonValue } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: s as unknown as Prisma.InputJsonValue } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "trade.settings_saved", entityType: "Setting", entityId: KEY, before: before as never, after: s as never });
  return s;
}

// ── VIES before invoicing without VAT ──

/** VIES_SIMULATE=1 (tests, development): numbers ending in 000 are not valid, the rest are. */
async function viesCall(vat: string, fetchImpl?: typeof fetch): Promise<ViesResult> {
  if (process.env.VIES_SIMULATE === "1" && !fetchImpl) {
    if (/000$/.test(vat)) return { result: "INVALID" };
    return { result: "VALID", registeredName: null, consultationRef: `SIM-${Date.now().toString(36).toUpperCase()}` };
  }
  return checkVies(vat, fetchImpl);
}

export type ViesProof = { valid: boolean; id: string | null; ref: string | null; checkedAt: string | null; result: string; reused: boolean };

/**
 * The buyer's VAT number for an exempt intra-EU supply: a VALID check younger than `maxAgeDays` is reused,
 * otherwise VIES is asked now and the answer stored as proof. VIES down → the last valid check (setting)
 * or not valid (local VAT is charged).
 */
export async function viesForInvoice(tx: Tx, company: { id: string; vatNumber: string | null; countryCode: string }, s: TradeSettings, fetchImpl?: typeof fetch): Promise<ViesProof> {
  const vat = vatWithPrefix(company.vatNumber, company.countryCode);
  if (!vat) return { valid: false, id: null, ref: null, checkedAt: null, result: "MISSING", reused: false };
  const lastValid = await tx.vatValidation.findFirst({ where: { companyId: company.id, result: "VALID" }, orderBy: { checkedAt: "desc" } });
  const fresh = lastValid && (!s.vies.recheck || Date.now() - lastValid.checkedAt.getTime() <= s.vies.maxAgeDays * 86400000);
  if (lastValid && fresh) return { valid: true, id: lastValid.id, ref: lastValid.consultationRef, checkedAt: lastValid.checkedAt.toISOString(), result: "VALID", reused: true };
  const r = await viesCall(vat, fetchImpl);
  const row = await tx.vatValidation.create({
    data: {
      companyId: company.id, vatNumber: vat, result: r.result, registeredName: r.registeredName ?? null, registeredAddress: r.registeredAddress ?? null,
      consultationRef: r.consultationRef ?? (r.error ? `error: ${r.error}`.slice(0, 190) : null), purpose: "INVOICE",
    },
  });
  if (r.result === "VALID") return { valid: true, id: row.id, ref: row.consultationRef, checkedAt: row.checkedAt.toISOString(), result: "VALID", reused: false };
  if (r.result === "ERROR" && s.vies.onError === "LAST_VALID" && lastValid)
    return { valid: true, id: lastValid.id, ref: lastValid.consultationRef, checkedAt: lastValid.checkedAt.toISOString(), result: "VALID", reused: true };
  return { valid: false, id: row.id, ref: row.consultationRef, checkedAt: row.checkedAt.toISOString(), result: r.result, reused: false };
}

async function defaultEntity(tx: Tx) {
  const def = (await tx.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: "marketplace.defaultCountry" } }))?.value as string | undefined;
  return (await tx.legalEntity.findFirst({ where: { isActive: true, ...(def ? { country: { code: def } } : {}) } })) ?? tx.legalEntity.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
}

export type SaleDecision =
  | { kind: "DOMESTIC"; le: Awaited<ReturnType<typeof defaultEntity>> & object }
  | { kind: "INTRA_EU_SUPPLY" | "LOCAL_VAT"; le: Awaited<ReturnType<typeof defaultEntity>> & object; proof: ViesProof };

/**
 * Which FIRINGI entity invoices a delivered order and how: its own country's entity (domestic), or — with no
 * entity there — the main entity, as an exempt intra-EU supply when the buyer's VAT number is valid at VIES,
 * otherwise with the main entity's local VAT. Goods must leave from the main entity's country.
 */
export async function saleFor(tx: Tx, order: { countryId: string; buyer: { id: string; vatNumber: string | null; country: { code: string; isEU: boolean } }; seller: { countryId: string } }, fetchImpl?: typeof fetch): Promise<SaleDecision> {
  const own = await tx.legalEntity.findFirst({ where: { countryId: order.countryId, isActive: true } });
  if (own) return { kind: "DOMESTIC", le: own };
  const s = await tradeSettings(tx);
  const main = await defaultEntity(tx);
  if (!s.crossBorderSales || !main || !order.buyer.country.isEU || order.seller.countryId !== main.countryId) throw new Error("No FIRINGI legal entity configured for this country.");
  const proof = await viesForInvoice(tx, { id: order.buyer.id, vatNumber: order.buyer.vatNumber, countryCode: order.buyer.country.code }, s, fetchImpl);
  return { kind: proof.valid ? "INTRA_EU_SUPPLY" : "LOCAL_VAT", le: main, proof };
}

/** At checkout: a buyer FIRINGI will invoice as an exempt intra-EU supply sees 0 % VAT (re-checked when invoicing). */
export async function zeroRatedBuyer(companyId: string, db: Tx | typeof prisma = prisma) {
  const co = await db.company.findUnique({ where: { id: companyId }, select: { countryId: true, vatNumber: true, country: { select: { isEU: true } } } });
  if (!co?.vatNumber || !co.country.isEU) return false;
  if (await db.legalEntity.count({ where: { countryId: co.countryId, isActive: true } })) return false;
  const s = await tradeSettings(db);
  if (!s.enabled || !s.crossBorderSales) return false;
  const last = await db.vatValidation.findFirst({ where: { companyId }, orderBy: { checkedAt: "desc" }, select: { result: true } });
  return last?.result === "VALID";
}

/** The exemption reason for an intra-EU supply in the entity's country (Portugal: M16, art. 14.º RITI). */
export async function intraEuExemption(tx: Tx, countryId: string) {
  return (await tx.taxExemptionReason.findFirst({ where: { countryId, code: "M16", isActive: true }, select: { id: true } }))?.id ?? null;
}

/** Link a new VIES check to the invoice it proves. */
export async function linkProof(tx: Tx, proof: ViesProof, invoiceId: string) {
  if (proof.id && !proof.reused) await tx.vatValidation.update({ where: { id: proof.id }, data: { invoiceId } });
}

// ── customs data of a product ──

type CustomsSrc = {
  product: { id: string; hsCode: string | null; originCountryCode: string | null; suppUnit: string | null; category: { cnCode: string | null; suppUnit: string | null; path: string } };
  packaging: { netWeightKg: Prisma.Decimal | null; suppUnits: Prisma.Decimal | null } | null;
};
const catCache = new Map<string, { cnCode: string | null; suppUnit: string | null }>();
async function categoryDefaults(path: string, own: { cnCode: string | null; suppUnit: string | null }) {
  if (own.cnCode) return own;
  const ids = path.split("/").filter(Boolean).reverse();
  for (const id of ids) {
    let c = catCache.get(id);
    if (!c) { c = (await prisma.category.findUnique({ where: { id }, select: { cnCode: true, suppUnit: true } })) ?? { cnCode: null, suppUnit: null }; catCache.set(id, c); }
    if (c.cnCode) return c;
  }
  return { cnCode: null, suppUnit: own.suppUnit };
}

export async function customsOf(src: CustomsSrc, s: TradeSettings) {
  const problems: Problem[] = [];
  let cn = src.product.hsCode ? normaliseCn(src.product.hsCode) : null;
  if (src.product.hsCode && !cn) problems.push("BAD_CN");
  const cat = await categoryDefaults(src.product.category.path, src.product.category);
  if (!src.product.hsCode && s.codes.categoryDefault && cat.cnCode) { cn = normaliseCn(cat.cnCode); if (cn) problems.push("CATEGORY_CN"); }
  if (!cn && !problems.includes("BAD_CN")) problems.push("MISSING_CN");
  const netKg = src.packaging?.netWeightKg != null ? D(src.packaging.netWeightKg) : null;
  return {
    cn, origin: src.product.originCountryCode, netKgPerPack: netKg, suppPerPack: src.packaging?.suppUnits != null ? D(src.packaging.suppUnits) : null,
    suppUnit: src.product.suppUnit ?? cat.suppUnit ?? src.product.category.suppUnit ?? null, problems,
  };
}

const PRODUCT_SELECT = { id: true, hsCode: true, originCountryCode: true, suppUnit: true, category: { select: { cnCode: true, suppUnit: true, path: true } } } as const;
const OFFER_SELECT = { offer: { select: { packaging: { select: { netWeightKg: true, suppUnits: true, variant: { select: { product: { select: PRODUCT_SELECT } } } } } } } } as const;

// ── building the lines ──

type Entity = { id: string; countryId: string; legalName: string; vatNumber: string; taxId: string; phone: string | null; country: { code: string } };
export type BuiltLine = TradeLine & { partnerCompanyId: string | null; sourceType: string; sourceId: string; sourceDate: Date; orderId: string | null; productId: string | null; problems: Problem[] };

async function partnerProblems(companyId: string, vat: string | null): Promise<Problem[]> {
  if (!vat) return ["MISSING_VAT"];
  const last = await prisma.vatValidation.findFirst({ where: { companyId }, orderBy: { checkedAt: "desc" }, select: { result: true } });
  return last && last.result === "INVALID" ? ["VAT_NOT_VALID"] : [];
}

/**
 * Where a document goes. Normally the return of its own period. A document dated in a period FIRINGI already
 * filed — issued after the filing — goes into the first return after it that isn't filed, as a correction of
 * its own period. A credit for a document of an earlier, filed period is marked as correcting that period.
 */
function placer(kind: TradeReturnKind, le: string, period: string, s: TradeSettings) {
  const cache = new Map<string, { status: TradeReturnStatus; filedAt: Date | null } | null>();
  const look = async (p: string) => {
    if (!cache.has(p)) cache.set(p, await prisma.tradeReturn.findUnique({ where: { legalEntityId_kind_period: { legalEntityId: le, kind, period: p } }, select: { status: true, filedAt: true } }));
    return cache.get(p) ?? null;
  };
  const freq = frequencyOf(period);
  return async (date: Date, originalDate: Date | null): Promise<{ include: boolean; corrects: string | null }> => {
    const own = periodOf(date, freq);
    let corrects: string | null = null;
    if (own !== period) {
      const r = await look(own);
      if (!r || r.status !== "FILED" || !r.filedAt || date <= r.filedAt) return { include: false, corrects: null };
      let p = nextPeriod(own), target: string | null = null;
      for (let i = 0; i < 36 && !target; i++, p = nextPeriod(p)) if ((await look(p))?.status !== "FILED") target = p;
      if (target !== period) return { include: false, corrects: null };
      corrects = own;
    }
    if (originalDate) {
      const op = periodOf(originalDate, freq);
      if (op !== period && (await look(op))?.status === "FILED") corrects = op;
    }
    return { include: true, corrects: s.corrections ? corrects : null };
  };
}

const EXCISE_PREFIX = "Imposto especial de consumo"; // = invoicing EXCISE_PREFIX (no import: avoids a cycle)

/** Lines of one return, from the documents in [start, end). */
export async function buildLines(kind: TradeKind, le: Entity, period: string, s: TradeSettings): Promise<BuiltLine[]> {
  const { start, end } = periodRange(period);
  const lateFrom = new Date(start.getTime() - 366 * 86400000);
  const place = placer(kind, le.id, period, s);
  const out: BuiltLine[] = [];
  const d = s.defaults;
  if (kind === "ARRIVALS") {
    // Reverse-charge statements: FIRINGI bought from a supplier in another EU country.
    const sts = await prisma.vendorBillingStatement.findMany({
      where: { taxRegime: "INTRA_EU_REVERSE_CHARGE", createdAt: { gte: lateFrom, lt: end }, salesInvoice: { legalEntityId: le.id } },
      include: { vendor: { select: { id: true, legalName: true, tradeName: true, vatNumber: true, country: { select: { code: true, isEU: true } } } }, order: { select: { id: true, number: true } } },
      orderBy: { createdAt: "asc" },
    });
    for (const st of sts) {
      if (!st.vendor.country.isEU || st.vendor.country.code === le.country.code) continue;
      const sign = st.isCreditStatement ? -1 : 1;
      const lines = (st.lines as { orderLineId: string | null; sku: string; qty: number; lineNet: string; description: string }[]).filter((l) => l.orderLineId && !l.sku.startsWith("EXCISE-") && l.sku !== "DELIVERY");
      if (!lines.length) continue;
      const ols = await prisma.orderLine.findMany({ where: { id: { in: lines.map((l) => l.orderLineId!) } }, select: { id: true, qtyDelivered: true, qtyConfirmed: true, qtyOrdered: true, cwBilledKg: true, ...OFFER_SELECT } });
      const byId = new Map(ols.map((o) => [o.id, o]));
      const orig = st.isCreditStatement ? (await prisma.vendorBillingStatement.findFirst({ where: { orderId: st.orderId, isCreditStatement: false }, select: { createdAt: true } }))?.createdAt ?? null : null;
      const where = await place(st.createdAt, orig);
      if (!where.include) continue;
      const corrects = where.corrects;
      const vat = vatWithPrefix(st.vendor.vatNumber, st.vendor.country.code);
      const pp = await partnerProblems(st.vendor.id, vat);
      for (const l of lines) {
        const ol = byId.get(l.orderLineId!);
        if (!ol) continue;
        const pk = ol.offer.packaging;
        const c = await customsOf({ product: pk.variant.product, packaging: pk }, s);
        const delivered = ol.qtyDelivered ?? ol.qtyConfirmed ?? ol.qtyOrdered;
        const share = delivered ? Math.abs(l.qty) / delivered : 1;
        const mass = ol.cwBilledKg != null ? D(ol.cwBilledKg).mul(share) : c.netKgPerPack ? c.netKgPerPack.mul(Math.abs(l.qty)) : null;
        const problems: Problem[] = [...c.problems, ...(mass ? [] : ["MISSING_MASS" as const]), ...(c.origin ? [] : ["MISSING_ORIGIN" as const])];
        out.push({
          partnerCountry: st.vendor.country.code, partnerVat: vat, partnerName: cname(st.vendor), partnerCompanyId: st.vendor.id, indicator: "GOODS",
          cnCode: c.cn, description: l.description, originCountry: c.origin, netMassKg: mass ? sign * mass.toDecimalPlaces(3).toNumber() : null,
          suppQty: c.suppPerPack ? sign * c.suppPerPack.mul(Math.abs(l.qty)).toDecimalPlaces(3).toNumber() : null, suppUnit: c.suppUnit,
          value: sign * Math.abs(Number(l.lineNet)), natureCode: st.isCreditStatement ? "21" : d.natureCode, transportMode: d.transportMode, deliveryTerms: d.deliveryTerms,
          correctsPeriod: corrects, sourceType: st.isCreditStatement ? "CREDIT_STATEMENT" : "STATEMENT", sourceId: st.id, sourceNumber: st.selfBilledNumber ?? st.number, sourceDate: st.createdAt,
          orderId: st.order.id, productId: pk.variant.product.id, problems: [...new Set([...problems, ...pp])],
        });
      }
    }
    return out;
  }
  // FIRINGI's own documents to other EU countries
  const regimes = kind === "ECSL" ? (["INTRA_EU_SUPPLY", "INTRA_EU_REVERSE_CHARGE"] as const) : (["INTRA_EU_SUPPLY"] as const);
  const invs = await prisma.invoice.findMany({
    where: { legalEntityId: le.id, taxRegime: { in: [...regimes] }, status: { not: "DRAFT" }, issuedAt: { gte: lateFrom, lt: end } },
    include: {
      recipient: { select: { id: true, legalName: true, tradeName: true, vatNumber: true, country: { select: { code: true, isEU: true } } } },
      originalInvoice: { select: { issuedAt: true } },
      lines: { orderBy: { position: "asc" }, include: { orderLine: { select: { id: true, qtyDelivered: true, qtyConfirmed: true, qtyOrdered: true, cwBilledKg: true, ...OFFER_SELECT } } } },
    },
    orderBy: { issuedAt: "asc" },
  });
  for (const inv of invs) {
    if (!inv.recipient.country.isEU || inv.recipient.country.code === le.country.code) continue;
    const sign = inv.docType === "CREDIT_NOTE" ? -1 : 1;
    const snap = inv.recipientSnapshot as { vatNumber?: string | null };
    const vat = vatWithPrefix(snap.vatNumber ?? inv.recipient.vatNumber, inv.recipient.country.code);
    const pp = await partnerProblems(inv.recipient.id, vat);
    const where = await place(inv.issuedAt!, inv.docType === "CREDIT_NOTE" ? inv.originalInvoice?.issuedAt ?? null : null);
    if (!where.include) continue;
    const corrects = where.corrects;
    const base = { partnerCountry: inv.recipient.country.code, partnerVat: vat, partnerName: cname(inv.recipient), partnerCompanyId: inv.recipient.id, sourceType: inv.docType === "CREDIT_NOTE" ? "CREDIT_NOTE" : "INVOICE", sourceId: inv.id, sourceNumber: inv.providerNumber ?? inv.fullNumber, sourceDate: inv.issuedAt!, orderId: inv.orderId, correctsPeriod: corrects };
    if (kind === "ECSL") {
      const indicator: Indicator = inv.taxRegime === "INTRA_EU_REVERSE_CHARGE" ? "SERVICES" : "GOODS";
      out.push({ ...base, indicator, cnCode: null, description: null, originCountry: null, netMassKg: null, suppQty: null, suppUnit: null, value: sign * Math.abs(Number(inv.netTotal)), natureCode: null, transportMode: null, deliveryTerms: null, productId: null, problems: pp });
      continue;
    }
    for (const l of inv.lines) {
      if (!l.orderLine || l.description.startsWith(EXCISE_PREFIX)) continue;
      const ol = l.orderLine, pk = ol.offer.packaging;
      const c = await customsOf({ product: pk.variant.product, packaging: pk }, s);
      const qty = Math.abs(Number(l.qty));
      const delivered = ol.qtyDelivered ?? ol.qtyConfirmed ?? ol.qtyOrdered;
      const mass = ol.cwBilledKg != null ? D(ol.cwBilledKg).mul(delivered ? qty / delivered : 1) : c.netKgPerPack ? c.netKgPerPack.mul(qty) : null;
      out.push({
        ...base, indicator: "GOODS", cnCode: c.cn, description: l.description, originCountry: c.origin, netMassKg: mass ? sign * mass.toDecimalPlaces(3).toNumber() : null,
        suppQty: c.suppPerPack ? sign * c.suppPerPack.mul(qty).toDecimalPlaces(3).toNumber() : null, suppUnit: c.suppUnit, value: sign * Math.abs(Number(l.lineNet)),
        natureCode: sign < 0 ? "21" : d.natureCode, transportMode: d.transportMode, deliveryTerms: d.deliveryTerms, productId: pk.variant.product.id,
        problems: [...new Set([...c.problems, ...(mass ? [] : ["MISSING_MASS" as const]), ...(c.origin ? [] : ["MISSING_ORIGIN" as const]), ...pp])],
      });
    }
  }
  return out;
}

// ── returns ──

async function entities() {
  return prisma.legalEntity.findMany({ where: { isActive: true }, include: { country: { select: { code: true } } }, orderBy: { createdAt: "asc" } });
}
const kindOn = (s: TradeSettings, k: TradeKind) => (k === "ECSL" ? s.returns.ecsl : k === "ARRIVALS" ? s.returns.arrivals : s.returns.dispatches);
function periodFor(s: TradeSettings, k: TradeKind, countryCode: string, at: Date) {
  return periodOf(at, k === "ECSL" ? countrySettings(s, countryCode).ecslPeriod : "MONTHLY");
}
function dueFor(s: TradeSettings, k: TradeKind, countryCode: string, period: string) {
  const c = countrySettings(s, countryCode);
  return dueOn(period, k === "ECSL" ? c.ecslDueDay : c.intrastatDueDay);
}

/** The return row of a period (created when first needed). */
export async function ensureReturn(le: Entity, kind: TradeKind, period: string, s: TradeSettings) {
  const { start, end } = periodRange(period);
  return prisma.tradeReturn.upsert({
    where: { legalEntityId_kind_period: { legalEntityId: le.id, kind, period } },
    update: {},
    create: { legalEntityId: le.id, kind, period, periodStart: start, periodEnd: end, dueOn: dueFor(s, kind, le.country.code, period) },
  });
}

/** Rebuild the lines of an open or ready return from the documents (a filed return never changes). */
export async function rebuildReturn(id: string) {
  const r = await prisma.tradeReturn.findUniqueOrThrow({ where: { id }, include: { legalEntity: { include: { country: { select: { code: true } } } } } });
  if (r.status === "FILED") throw new ValidationError("This return is filed. Changes go into the next period as corrections.");
  const s = await tradeSettings();
  const lines = await buildLines(r.kind, r.legalEntity, r.period, s);
  const total = lines.reduce((a, l) => a.plus(l.value), new Decimal(0));
  const mass = lines.reduce((a, l) => a.plus(l.netMassKg ?? 0), new Decimal(0));
  const problems = lines.filter((l) => l.problems.some((p) => BLOCKING.includes(p))).length;
  await prisma.$transaction(async (tx) => {
    await tx.tradeReturnLine.deleteMany({ where: { returnId: id } });
    if (lines.length)
      await tx.tradeReturnLine.createMany({
        data: lines.map((l, i) => ({
          returnId: id, position: i + 1, partnerCountry: l.partnerCountry, partnerVat: l.partnerVat, partnerName: l.partnerName, partnerCompanyId: l.partnerCompanyId, indicator: l.indicator,
          cnCode: l.cnCode, description: l.description?.slice(0, 300) ?? null, originCountry: l.originCountry, netMassKg: l.netMassKg, suppQty: l.suppQty, suppUnit: l.suppUnit,
          value: l.value.toFixed(2), natureCode: l.natureCode, transportMode: l.transportMode, deliveryTerms: l.deliveryTerms, correctsPeriod: l.correctsPeriod,
          sourceType: l.sourceType, sourceId: l.sourceId, sourceNumber: l.sourceNumber, sourceDate: l.sourceDate, orderId: l.orderId, productId: l.productId, problems: l.problems,
        })),
      });
    await tx.tradeReturn.update({
      where: { id },
      data: { totalValue: r2(total).toFixed(2), totalMassKg: mass.toDecimalPlaces(3).toFixed(3), lineCount: lines.length, problemCount: problems, correctionCount: lines.filter((l) => l.correctsPeriod).length, builtAt: new Date(), ...(r.status === "READY" && problems ? { status: "OPEN" as TradeReturnStatus, readyAt: null, readyById: null } : {}) },
    });
  });
  return prisma.tradeReturn.findUniqueOrThrow({ where: { id } });
}

/** Returns for the current and the previous period of every enabled kind, rebuilt while open. */
export async function refreshReturns(at = new Date()) {
  const s = await tradeSettings();
  if (!s.enabled) return [];
  const out = [];
  for (const le of await entities())
    for (const k of ["ECSL", "ARRIVALS", "DISPATCHES"] as TradeKind[]) {
      if (!kindOn(s, k)) continue;
      const cur = periodFor(s, k, le.country.code, at);
      const prev = periodFor(s, k, le.country.code, new Date(periodRange(cur).start.getTime() - 86400000));
      for (const p of [prev, cur]) {
        const r = await ensureReturn(le, k, p, s);
        out.push(r.status === "FILED" ? r : await rebuildReturn(r.id));
      }
    }
  return out;
}

/** Intrastat must be filed for this flow (over the threshold or told by the statistics office). */
export function obliged(s: TradeSettings, kind: TradeKind, countryCode: string) {
  if (kind === "ECSL") return true;
  const c = countrySettings(s, countryCode);
  return kind === "ARRIVALS" ? c.arrivalsObliged : c.dispatchesObliged;
}

// ── thresholds ──

/** Goods value of the year so far (and last year) per entity and flow, against the country's threshold. */
export async function thresholds(at = new Date()) {
  const s = await tradeSettings();
  const y = at.getUTCFullYear();
  const out = [];
  for (const le of await entities()) {
    const c = countrySettings(s, le.country.code);
    for (const flow of ["ARRIVALS", "DISPATCHES"] as const) {
      const sum = async (year: number) => {
        const lines = await buildYear(le, flow, year, s);
        return lines;
      };
      const [cur, last] = await Promise.all([sum(y), sum(y - 1)]);
      const threshold = flow === "ARRIVALS" ? c.arrivalsThreshold : c.dispatchesThreshold;
      out.push({
        entityId: le.id, entity: le.legalName, country: le.country.code, flow, year: y, ytd: cur, lastYear: last, threshold,
        pct: threshold > 0 ? Math.round((cur / threshold) * 1000) / 10 : null, obliged: flow === "ARRIVALS" ? c.arrivalsObliged : c.dispatchesObliged,
        over: threshold > 0 && (cur > threshold || last > threshold),
      });
    }
  }
  return out;
}

/** Goods value of a calendar year in one flow (credits subtracted). */
async function buildYear(le: Entity, flow: "ARRIVALS" | "DISPATCHES", year: number, s: TradeSettings) {
  const start = new Date(Date.UTC(year, 0, 1)), end = new Date(Date.UTC(year + 1, 0, 1));
  if (flow === "ARRIVALS") {
    const sts = await prisma.vendorBillingStatement.findMany({ where: { taxRegime: "INTRA_EU_REVERSE_CHARGE", createdAt: { gte: start, lt: end }, salesInvoice: { legalEntityId: le.id } }, select: { isCreditStatement: true, lines: true } });
    return sts.reduce((a, st) => a + (st.isCreditStatement ? -1 : 1) * (st.lines as { orderLineId: string | null; sku: string; lineNet: string }[]).filter((l) => l.orderLineId && !l.sku.startsWith("EXCISE-")).reduce((x, l) => x + Math.abs(Number(l.lineNet)), 0), 0);
  }
  void s;
  const invs = await prisma.invoice.findMany({ where: { legalEntityId: le.id, taxRegime: "INTRA_EU_SUPPLY", status: { not: "DRAFT" }, issuedAt: { gte: start, lt: end } }, select: { docType: true, lines: { where: { orderLineId: { not: null } }, select: { lineNet: true, description: true } } } });
  return invs.reduce((a, i) => a + (i.docType === "CREDIT_NOTE" ? -1 : 1) * i.lines.filter((l) => !l.description.startsWith(EXCISE_PREFIX)).reduce((x, l) => x + Math.abs(Number(l.lineNet)), 0), 0);
}

// ── daily job: returns, reminders, threshold watch ──

export async function runTradeJob(at = new Date()) {
  const s = await tradeSettings();
  if (!s.enabled) return { returns: 0, reminders: 0, warnings: 0 };
  const rs = await refreshReturns(at);
  const firingi = await firingiId();
  let reminders = 0, warnings = 0;
  if (s.reminders.enabled) {
    const open = await prisma.tradeReturn.findMany({ where: { status: { not: "FILED" } }, include: { legalEntity: { include: { country: { select: { code: true } } } } } });
    for (const r of open) {
      if (!kindOn(s, r.kind) || (!obliged(s, r.kind, r.legalEntity.country.code) && r.lineCount === 0)) continue;
      if (r.kind !== "ECSL" && !obliged(s, r.kind, r.legalEntity.country.code)) continue;
      const left = daysUntil(r.dueOn, at);
      const due = s.reminders.days.filter((d) => left <= d && !r.remindedDays.includes(d));
      if (!due.length || left < -3) continue;
      await notify("trade.deadline", [{ companyId: firingi, link: `/admin/invoices/eu-trade/returns/${r.id}` }], { return: KIND_NAME[r.kind], period: r.period, date: r.dueOn.toISOString().slice(0, 10), days: Math.max(0, left) }, { ref: { type: "TradeReturn", id: r.id } }).catch(() => null);
      await prisma.tradeReturn.update({ where: { id: r.id }, data: { remindedDays: [...r.remindedDays, ...due] } });
      reminders++;
    }
  }
  if (s.thresholds.watch) {
    const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: WARNED } });
    const warned = { ...((row?.value ?? {}) as Record<string, string>) };
    for (const t of await thresholds(at)) {
      if (t.obliged || t.threshold <= 0 || t.pct == null) continue;
      const level = t.pct >= 100 ? "OVER" : t.pct >= s.thresholds.warnAtPct ? "NEAR" : null;
      const k = `${t.entityId}:${t.flow}:${t.year}:${level}`;
      if (!level || warned[k]) continue;
      await notify("trade.threshold", [{ companyId: firingi, link: "/admin/invoices/eu-trade" }], { country: t.country, flow: t.flow === "ARRIVALS" ? "arrivals" : "dispatches", pct: Math.floor(t.pct), threshold: t.threshold.toLocaleString("en") }, {}).catch(() => null);
      warned[k] = at.toISOString();
      warnings++;
    }
    if (warnings) {
      if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: warned } });
      else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: WARNED, value: warned } });
    }
  }
  return { returns: rs.length, reminders, warnings };
}

export const KIND_NAME: Record<TradeKind, string> = { ECSL: "EC Sales List", ARRIVALS: "Intrastat arrivals", DISPATCHES: "Intrastat dispatches" };

// ── FIRINGI's pages ──

export async function tradeOverview(ctx: Ctx, at = new Date()) {
  staffOnly(ctx, false);
  const s = await tradeSettings();
  const [returns, th, pending, invalid] = await Promise.all([
    prisma.tradeReturn.findMany({ where: { OR: [{ status: { not: "FILED" } }, { periodEnd: { gte: new Date(at.getTime() - 120 * 86400000) } }] }, include: { legalEntity: { include: { country: { select: { code: true } } } } }, orderBy: [{ dueOn: "asc" }, { kind: "asc" }] }),
    thresholds(at),
    prisma.tradeCodeProposal.count({ where: { status: "PENDING" } }),
    prisma.tradeReturnLine.count({ where: { tradeReturn: { status: { not: "FILED" } }, problems: { hasSome: ["VAT_NOT_VALID", "MISSING_VAT"] } } }),
  ]);
  const missing = await prisma.tradeReturnLine.count({ where: { tradeReturn: { status: { not: "FILED" } }, problems: { hasSome: ["MISSING_CN", "BAD_CN", "MISSING_MASS"] } } });
  return {
    settings: s, pendingCodes: pending, vatProblems: invalid, dataProblems: missing, thresholds: th,
    returns: returns.map((r) => ({ ...rowOf(r), daysLeft: daysUntil(r.dueOn, at), obliged: obliged(s, r.kind, r.legalEntity.country.code) })),
  };
}

type ReturnRow = Awaited<ReturnType<typeof prisma.tradeReturn.findFirstOrThrow>> & { legalEntity: { legalName: string; country: { code: string } } };
function rowOf(r: ReturnRow) {
  return {
    id: r.id, kind: r.kind, kindName: KIND_NAME[r.kind], period: r.period, entity: r.legalEntity.legalName, country: r.legalEntity.country.code, status: r.status,
    dueOn: r.dueOn.toISOString().slice(0, 10), total: D(r.totalValue).toFixed(2), massKg: D(r.totalMassKg).toFixed(3), lines: r.lineCount, problems: r.problemCount, corrections: r.correctionCount,
    filedAt: r.filedAt?.toISOString() ?? null, filingRef: r.filingRef, builtAt: r.builtAt?.toISOString() ?? null,
  };
}

export async function listReturns(ctx: Ctx, f: { kind?: string; status?: string; year?: string } = {}) {
  staffOnly(ctx, false);
  const where: Prisma.TradeReturnWhereInput = {
    ...(f.kind && ["ECSL", "ARRIVALS", "DISPATCHES"].includes(f.kind) ? { kind: f.kind as TradeReturnKind } : {}),
    ...(f.status && ["OPEN", "READY", "FILED"].includes(f.status) ? { status: f.status as TradeReturnStatus } : {}),
    ...(f.year && /^\d{4}$/.test(f.year) ? { period: { startsWith: f.year } } : {}),
  };
  const rows = await prisma.tradeReturn.findMany({ where, include: { legalEntity: { include: { country: { select: { code: true } } } } }, orderBy: [{ periodStart: "desc" }, { kind: "asc" }], take: 300 });
  return rows.map(rowOf);
}

/** Create (or open) the return of a period on demand — e.g. an older month FIRINGI still has to file. */
export async function openReturn(ctx: Ctx, i: { legalEntityId: string; kind: TradeKind; period: string }) {
  staffOnly(ctx, true);
  if (!isPeriod(i.period)) throw new ValidationError("Use a period like 2026-11 or 2026-Q4.");
  const s = await tradeSettings();
  const le = await prisma.legalEntity.findUnique({ where: { id: i.legalEntityId }, include: { country: { select: { code: true } } } });
  if (!le) throw new NotFoundError();
  if (i.kind !== "ECSL" && frequencyOf(i.period) !== "MONTHLY") throw new ValidationError("Intrastat is monthly.");
  const r = await ensureReturn(le, i.kind, i.period, s);
  return r.status === "FILED" ? r : rebuildReturn(r.id);
}

export async function returnDetail(ctx: Ctx, id: string) {
  staffOnly(ctx, false);
  const r = await prisma.tradeReturn.findUnique({ where: { id }, include: { legalEntity: { include: { country: { select: { code: true } } } }, lines: { orderBy: { position: "asc" } } } });
  if (!r) throw new NotFoundError();
  const s = await tradeSettings();
  const lines = r.lines.map(lineOf);
  const t = genericTable(r.kind, lines, s.defaults);
  const users = await prisma.user.findMany({ where: { id: { in: [r.readyById, r.filedById].filter(Boolean) as string[] } }, select: { id: true, name: true, email: true } });
  const who = (uid: string | null) => { const u = users.find((x) => x.id === uid); return u ? u.name ?? u.email : null; };
  return {
    ...rowOf(r), readyBy: who(r.readyById), filedBy: who(r.filedById), readyAt: r.readyAt?.toISOString() ?? null, note: r.note, format: countrySettings(s, r.legalEntity.country.code).format,
    obliged: obliged(s, r.kind, r.legalEntity.country.code), summary: t,
    items: r.lines.map((l) => ({
      id: l.id, partner: l.partnerName, partnerCompanyId: l.partnerCompanyId, country: l.partnerCountry, vat: l.partnerVat, indicator: l.indicator, cn: l.cnCode, description: l.description, origin: l.originCountry,
      massKg: l.netMassKg == null ? null : D(l.netMassKg).toFixed(3), supp: l.suppQty == null ? null : D(l.suppQty).toFixed(3), suppUnit: l.suppUnit, value: D(l.value).toFixed(2),
      corrects: l.correctsPeriod, source: l.sourceType, sourceId: l.sourceId, number: l.sourceNumber, date: l.sourceDate?.toISOString().slice(0, 10) ?? null, orderId: l.orderId, productId: l.productId, problems: l.problems,
    })),
  };
}

function lineOf(l: { partnerCountry: string; partnerVat: string | null; partnerName: string | null; indicator: string | null; cnCode: string | null; description: string | null; originCountry: string | null; netMassKg: Prisma.Decimal | null; suppQty: Prisma.Decimal | null; suppUnit: string | null; value: Prisma.Decimal; natureCode: string | null; transportMode: string | null; deliveryTerms: string | null; correctsPeriod: string | null; sourceNumber: string | null }): TradeLine {
  return {
    partnerCountry: l.partnerCountry, partnerVat: l.partnerVat, partnerName: l.partnerName, indicator: (l.indicator as Indicator | null) ?? null, cnCode: l.cnCode, description: l.description, originCountry: l.originCountry,
    netMassKg: l.netMassKg == null ? null : Number(l.netMassKg), suppQty: l.suppQty == null ? null : Number(l.suppQty), suppUnit: l.suppUnit, value: Number(l.value), natureCode: l.natureCode,
    transportMode: l.transportMode, deliveryTerms: l.deliveryTerms, correctsPeriod: l.correctsPeriod, sourceNumber: l.sourceNumber,
  };
}

export async function rebuildReturnAction(ctx: Ctx, id: string) { staffOnly(ctx, true); return rebuildReturn(id); }

export async function markReady(ctx: Ctx, id: string) {
  staffOnly(ctx, true);
  const r = await rebuildReturn(id);
  if (r.problemCount) throw new ValidationError(`${r.problemCount} line(s) still have missing data. Fix them first, or file with the national tool and record the reference.`);
  await prisma.tradeReturn.update({ where: { id }, data: { status: "READY", readyAt: new Date(), readyById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "trade.return_ready", entityType: "TradeReturn", entityId: id, after: { period: r.period, kind: r.kind, total: r.totalValue.toString() } });
}

/** Filed at the authority: the lines freeze; later changes go into the next return as corrections. */
export async function markFiled(ctx: Ctx, id: string, i: { reference: string; note?: string | null }) {
  staffOnly(ctx, true);
  const r = await prisma.tradeReturn.findUnique({ where: { id } });
  if (!r) throw new NotFoundError();
  if (r.status === "FILED") throw new ValidationError("Already filed.");
  const ref = i.reference.trim();
  if (ref.length < 3) throw new ValidationError("Enter the submission reference the authority gave you.");
  if (r.status === "OPEN") await rebuildReturn(id);
  await prisma.tradeReturn.update({ where: { id }, data: { status: "FILED", filedAt: new Date(), filedById: ctx.user.id, filingRef: ref.slice(0, 120), note: i.note?.trim().slice(0, 500) || r.note } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "trade.return_filed", entityType: "TradeReturn", entityId: id, after: { period: r.period, kind: r.kind, reference: ref } });
}

/** Back to open (a READY return, or a FILED one that was filed by mistake — with a reason). */
export async function reopenReturn(ctx: Ctx, id: string, reason: string) {
  if (!isStaff(ctx) || !can(ctx, "admin.tax.manage")) throw new ForbiddenError();
  const r = await prisma.tradeReturn.findUnique({ where: { id } });
  if (!r) throw new NotFoundError();
  if (reason.trim().length < 5) throw new ValidationError("Say why it is reopened.");
  await prisma.tradeReturn.update({ where: { id }, data: { status: "OPEN", readyAt: null, readyById: null, filedAt: null, filedById: null, note: `${r.note ? `${r.note}\n` : ""}Reopened: ${reason.trim()}`.slice(0, 1000) } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "trade.return_reopened", entityType: "TradeReturn", entityId: id, before: { status: r.status, filingRef: r.filingRef }, after: { reason } });
  await rebuildReturn(id);
}

/** Files for download: generic CSV / Excel, or the national layout of the entity's country. */
export async function returnFile(ctx: Ctx, id: string, fmt: "csv" | "xlsx" | "national"): Promise<{ fileName: string; contentType: string; body: string | Buffer }> {
  staffOnly(ctx, false);
  const r = await prisma.tradeReturn.findUnique({ where: { id }, include: { legalEntity: { include: { country: { select: { code: true } } } }, lines: { orderBy: { position: "asc" } } } });
  if (!r) throw new NotFoundError();
  const s = await tradeSettings();
  const lines = r.lines.map(lineOf);
  const base = `${r.kind}_${r.legalEntity.country.code}_${r.period}`;
  if (fmt === "national") {
    const le = r.legalEntity;
    const decl: Declarant = { name: le.legalName, vat: vatWithPrefix(le.vatNumber, le.country.code) ?? le.taxId, taxId: le.taxId, country: le.country.code, phone: le.phone };
    const f: FileOut = nationalFile(countrySettings(s, le.country.code).format, r.kind, lines, s.defaults, decl, r.period);
    return f;
  }
  const t = genericTable(r.kind, lines, s.defaults);
  if (fmt === "xlsx") {
    const { toXlsx } = await import("@/server/integrations/accounting");
    const detail = { name: "Lines", headers: ["Document", "Date", "Partner", "VAT", "Country", "CN8", "Description", "Origin", "Net kg", "Value EUR", "Corrects", "Problems"], rows: r.lines.map((l) => [l.sourceNumber ?? "", l.sourceDate?.toISOString().slice(0, 10) ?? "", l.partnerName ?? "", l.partnerVat ?? "", l.partnerCountry, l.cnCode ?? "", l.description ?? "", l.originCountry ?? "", l.netMassKg == null ? "" : Number(l.netMassKg), Number(l.value), l.correctsPeriod ?? "", l.problems.join(", ")]), money: [9] };
    return { fileName: `${base}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: await toXlsx([t as never, detail as never], base) };
  }
  const { csv } = await import("@/lib/trade");
  return { fileName: `${base}.csv`, contentType: "text/csv; charset=utf-8", body: csv(t.headers, t.rows) };
}

// ── VIES log and re-checks ──

/** Partners in cross-border documents with their latest VIES result. */
export async function viesPartners(ctx: Ctx) {
  staffOnly(ctx, false);
  const ids = await prisma.tradeReturnLine.findMany({ where: { partnerCompanyId: { not: null } }, distinct: ["partnerCompanyId"], select: { partnerCompanyId: true } });
  const extra = await prisma.company.findMany({ where: { vatNumber: { not: null }, country: { isEU: true }, type: { in: ["DISTRIBUTOR", "WHOLESALER", "CUSTOMER"] }, NOT: { country: { legalEntities: { some: { isActive: true } } } } }, select: { id: true }, take: 300 });
  const all = [...new Set([...ids.map((x) => x.partnerCompanyId!), ...extra.map((x) => x.id)])];
  const cos = await prisma.company.findMany({
    where: { id: { in: all } },
    select: { id: true, legalName: true, tradeName: true, type: true, vatNumber: true, country: { select: { code: true } }, vatValidations: { orderBy: { checkedAt: "desc" }, take: 1 } },
    orderBy: { legalName: "asc" },
  });
  return cos.map((c) => {
    const v = c.vatValidations[0];
    return { id: c.id, name: cname(c), type: c.type, country: c.country.code, vat: vatWithPrefix(c.vatNumber, c.country.code), result: v?.result ?? null, checkedAt: v?.checkedAt.toISOString() ?? null, ref: v?.consultationRef ?? null, purpose: v?.purpose ?? null, name2: v?.registeredName ?? null };
  });
}

export async function viesHistory(ctx: Ctx, companyId: string) {
  staffOnly(ctx, false);
  const rows = await prisma.vatValidation.findMany({ where: { companyId }, orderBy: { checkedAt: "desc" }, take: 50 });
  const invs = await prisma.invoice.findMany({ where: { id: { in: rows.map((r) => r.invoiceId).filter(Boolean) as string[] } }, select: { id: true, fullNumber: true, providerNumber: true } });
  return rows.map((r) => ({ id: r.id, vat: r.vatNumber, result: r.result, ref: r.consultationRef, name: r.registeredName, address: r.registeredAddress, at: r.checkedAt.toISOString(), purpose: r.purpose, invoice: invs.find((i) => i.id === r.invoiceId)?.providerNumber ?? invs.find((i) => i.id === r.invoiceId)?.fullNumber ?? null }));
}

/** Check a partner's VAT number at VIES now (proof stored). */
export async function recheckVat(ctx: Ctx, companyId: string, fetchImpl?: typeof fetch) {
  staffOnly(ctx, true);
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, vatNumber: true, country: { select: { code: true, isEU: true } } } });
  if (!c) throw new NotFoundError();
  const vat = vatWithPrefix(c.vatNumber, c.country.code);
  if (!vat || !c.country.isEU) throw new ValidationError("This business has no EU VAT number.");
  const r = await viesCall(vat, fetchImpl);
  const row = await prisma.vatValidation.create({
    data: { companyId, vatNumber: vat, result: r.result, registeredName: r.registeredName ?? null, registeredAddress: r.registeredAddress ?? null, consultationRef: r.consultationRef ?? (r.error ? `error: ${r.error}`.slice(0, 190) : null), checkedById: ctx.user.id, purpose: "RECHECK" },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "trade.vies_rechecked", entityType: "Company", entityId: companyId, after: { vat, result: r.result } });
  return row;
}

// ── customs codes ──

const cnInput = (v: string | null | undefined, label = "CN8 code") => {
  if (v == null || v.trim() === "") return null;
  const c = normaliseCn(v);
  if (!c) throw new ValidationError(`${label}: 8 digits, e.g. 2202 10 00.`);
  return c;
};
const kgInput = (v: number | null | undefined, label: string) => {
  if (v == null || Number.isNaN(v)) return null;
  if (!(v > 0 && v < 100000)) throw new ValidationError(`${label} must be more than 0.`);
  return new Decimal(v).toDecimalPlaces(3).toFixed(3);
};
async function countryInput(v: string | null | undefined) {
  if (!v) return null;
  const c = v.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) throw new ValidationError("Country of origin: a two-letter code such as PT.");
  return c;
}

/** Products in cross-border flows (or with a supplier proposal) and their customs data — FIRINGI's code page. */
export async function codesPage(ctx: Ctx, f: { q?: string; missing?: boolean } = {}) {
  if (!isStaff(ctx) || !can(ctx, [...CODES, ...VIEW])) throw new ForbiddenError();
  const s = await tradeSettings();
  const pending = await prisma.tradeCodeProposal.findMany({
    where: { status: "PENDING" }, orderBy: { createdAt: "asc" },
    include: { company: { select: { legalName: true, tradeName: true } }, packaging: { select: { name: true, netWeightKg: true, suppUnits: true } }, product: { select: { id: true, name: true, hsCode: true, originCountryCode: true, suppUnit: true, category: { select: { name: true, cnCode: true, suppUnit: true, path: true } } } } },
  });
  const lineProducts = await prisma.tradeReturnLine.findMany({ where: { productId: { not: null }, tradeReturn: { status: { not: "FILED" } } }, distinct: ["productId"], select: { productId: true } });
  const q = f.q?.trim().toLowerCase();
  const products = await prisma.product.findMany({
    where: { id: { in: lineProducts.map((l) => l.productId!) }, ...(q ? { searchText: { contains: q } } : {}) },
    select: { id: true, name: true, hsCode: true, originCountryCode: true, suppUnit: true, cnCheckedAt: true, category: { select: { name: true, cnCode: true, suppUnit: true, path: true } }, variants: { select: { sku: true, packagings: { select: { id: true, name: true, netWeightKg: true, suppUnits: true } } } } },
    take: 300,
  });
  const rows = [];
  for (const p of products) {
    const packs = p.variants.flatMap((v) => v.packagings.map((k) => ({ id: k.id, sku: v.sku, name: pick(k.name), netKg: k.netWeightKg?.toString() ?? null, supp: k.suppUnits?.toString() ?? null })));
    const c = await customsOf({ product: p, packaging: packs[0] ? { netWeightKg: p.variants[0]?.packagings[0]?.netWeightKg ?? null, suppUnits: null } : null }, s);
    const missing = [...c.problems, ...(packs.some((k) => !k.netKg) ? ["MISSING_MASS"] : []), ...(p.originCountryCode ? [] : ["MISSING_ORIGIN"])];
    if (f.missing && !missing.some((m) => m !== "CATEGORY_CN")) continue;
    rows.push({ id: p.id, name: pick(p.name), category: pick(p.category.name), cn: p.hsCode, categoryCn: c.problems.includes("CATEGORY_CN") ? c.cn : null, origin: p.originCountryCode, suppUnit: p.suppUnit ?? c.suppUnit, checkedAt: p.cnCheckedAt?.toISOString() ?? null, packs, missing });
  }
  const cats = await prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true, cnCode: true, suppUnit: true, depth: true, path: true }, orderBy: [{ path: "asc" }] });
  return {
    pending: pending.map((x) => ({
      id: x.id, company: cname(x.company), productId: x.productId, product: pick(x.product.name), category: pick(x.product.category.name), pack: x.packaging ? pick(x.packaging.name) : null,
      cn: x.cnCode, netKg: x.netWeightKg?.toString() ?? null, supp: x.suppUnits?.toString() ?? null, origin: x.originCountryCode, note: x.note, createdAt: x.createdAt.toISOString(),
      current: { cn: x.product.hsCode, origin: x.product.originCountryCode, netKg: x.packaging?.netWeightKg?.toString() ?? null, supp: x.packaging?.suppUnits?.toString() ?? null, categoryCn: x.product.category.cnCode },
    })),
    products: rows,
    categories: cats.map((c) => ({ id: c.id, name: pick(c.name), depth: c.depth, cn: c.cnCode, suppUnit: c.suppUnit })),
  };
}

export async function setCategoryCn(ctx: Ctx, categoryId: string, i: { cnCode: string | null; suppUnit: string | null }) {
  if (!isStaff(ctx) || !can(ctx, [...CODES])) throw new ForbiddenError();
  const cn = cnInput(i.cnCode);
  const unit = i.suppUnit?.trim() ? i.suppUnit.trim().slice(0, 12) : null;
  const before = await prisma.category.findUniqueOrThrow({ where: { id: categoryId }, select: { cnCode: true, suppUnit: true } });
  await prisma.category.update({ where: { id: categoryId }, data: { cnCode: cn, suppUnit: unit } });
  catCache.clear();
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "trade.category_cn", entityType: "Category", entityId: categoryId, before, after: { cnCode: cn, suppUnit: unit } });
}

/** FIRINGI sets a product's customs data directly (checked). */
export async function setProductCustoms(ctx: Ctx, productId: string, i: { cnCode: string | null; originCountryCode: string | null; suppUnit: string | null; packs?: { id: string; netWeightKg?: number | null; suppUnits?: number | null }[] }) {
  if (!isStaff(ctx) || !can(ctx, [...CODES])) throw new ForbiddenError();
  const cn = cnInput(i.cnCode);
  const origin = await countryInput(i.originCountryCode);
  const p = await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { hsCode: true, originCountryCode: true, suppUnit: true, variants: { select: { packagings: { select: { id: true } } } } } });
  const packIds = new Set(p.variants.flatMap((v) => v.packagings.map((k) => k.id)));
  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id: productId }, data: { hsCode: cn, originCountryCode: origin, suppUnit: i.suppUnit?.trim().slice(0, 12) || null, cnCheckedAt: new Date(), cnCheckedById: ctx.user.id } });
    for (const k of i.packs ?? []) {
      if (!packIds.has(k.id)) throw new ValidationError("Unknown pack.");
      await tx.packagingUnit.update({ where: { id: k.id }, data: { netWeightKg: kgInput(k.netWeightKg, "Net mass"), suppUnits: kgInput(k.suppUnits, "Supplementary units") } });
    }
  });
  catCache.clear();
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "trade.product_customs", entityType: "Product", entityId: productId, before: { hsCode: p.hsCode, origin: p.originCountryCode }, after: { hsCode: cn, origin, packs: i.packs ?? [] } });
}

/** Accept (copy to the product, optionally corrected) or reject a supplier's customs data. */
export async function reviewProposal(ctx: Ctx, id: string, i: { accept: boolean; note?: string | null; cnCode?: string | null; netWeightKg?: number | null; suppUnits?: number | null; originCountryCode?: string | null }) {
  if (!isStaff(ctx) || !can(ctx, [...CODES])) throw new ForbiddenError();
  const x = await prisma.tradeCodeProposal.findUnique({ where: { id }, include: { product: { select: { name: true } } } });
  if (!x) throw new NotFoundError();
  if (x.status !== "PENDING") throw new ValidationError("Already decided.");
  if (!i.accept && !(i.note ?? "").trim()) throw new ValidationError("Tell the supplier what is wrong.");
  const cn = i.cnCode !== undefined ? cnInput(i.cnCode) : x.cnCode;
  const kg = i.netWeightKg !== undefined ? kgInput(i.netWeightKg, "Net mass") : x.netWeightKg?.toString() ?? null;
  const supp = i.suppUnits !== undefined ? kgInput(i.suppUnits, "Supplementary units") : x.suppUnits?.toString() ?? null;
  const origin = i.originCountryCode !== undefined ? await countryInput(i.originCountryCode) : x.originCountryCode;
  await prisma.$transaction(async (tx) => {
    await tx.tradeCodeProposal.update({ where: { id }, data: { status: i.accept ? "ACCEPTED" : "REJECTED", reviewNote: i.note?.trim().slice(0, 500) || null, reviewedById: ctx.user.id, reviewedAt: new Date(), ...(i.accept ? { cnCode: cn, netWeightKg: kg, suppUnits: supp, originCountryCode: origin } : {}) } });
    if (!i.accept) return;
    await tx.product.update({ where: { id: x.productId }, data: { ...(cn ? { hsCode: cn } : {}), ...(origin ? { originCountryCode: origin } : {}), cnCheckedAt: new Date(), cnCheckedById: ctx.user.id } });
    if (x.packagingUnitId && (kg || supp)) await tx.packagingUnit.update({ where: { id: x.packagingUnitId }, data: { ...(kg ? { netWeightKg: kg } : {}), ...(supp ? { suppUnits: supp } : {}) } });
  });
  catCache.clear();
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: i.accept ? "trade.code_accepted" : "trade.code_rejected", entityType: "TradeCodeProposal", entityId: id, after: { cn, kg, supp, origin, note: i.note ?? null } });
  await notify(i.accept ? "trade.code_accepted" : "trade.code_rejected", [{ companyId: x.companyId, link: "/vendor/products/customs" }], { product: pickLocalized(x.product.name as Record<string, string>, "pt"), ...(i.accept ? {} : { note: i.note ?? "" }) }, { ref: { type: "TradeCodeProposal", id } }).catch(() => null);
}

// ── suppliers ──

function supplierOnly(ctx: Ctx, perms: Parameters<typeof can>[1]) {
  if ((ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") || !can(ctx, perms)) throw new ForbiddenError();
}

/** The supplier's products with their customs data and its own latest proposal. */
export async function supplierCustoms(ctx: Ctx, locale: string, q?: string) {
  supplierOnly(ctx, ["vendor.products.view", "vendor.products.manage"]);
  const s = await tradeSettings();
  const offers = await prisma.vendorOffer.findMany({
    where: { vendorCompanyId: ctx.company.id, status: { in: ["ACTIVE", "PAUSED", "PENDING_APPROVAL"] }, ...(q?.trim() ? { packaging: { variant: { product: { searchText: { contains: q.trim().toLowerCase() } } } } } : {}) },
    select: { packaging: { select: { id: true, name: true, netWeightKg: true, suppUnits: true, variant: { select: { sku: true, product: { select: { ...PRODUCT_SELECT, name: true } } } } } } },
    take: 500,
  });
  const ids = [...new Set(offers.map((o) => o.packaging.variant.product.id))];
  const props = await prisma.tradeCodeProposal.findMany({ where: { companyId: ctx.company.id, productId: { in: ids } }, orderBy: { createdAt: "desc" } });
  const rows = [];
  for (const o of offers) {
    const pk = o.packaging, p = pk.variant.product;
    const c = await customsOf({ product: p, packaging: pk }, s);
    const last = props.find((x) => x.productId === p.id && (!x.packagingUnitId || x.packagingUnitId === pk.id));
    rows.push({
      productId: p.id, packagingUnitId: pk.id, name: pickLocalized(p.name as Record<string, string>, locale), pack: pickLocalized(pk.name as Record<string, string>, locale), sku: pk.variant.sku,
      cn: p.hsCode, categoryCn: c.problems.includes("CATEGORY_CN") ? c.cn : null, origin: p.originCountryCode, netKg: pk.netWeightKg?.toString() ?? null, supp: pk.suppUnits?.toString() ?? null, suppUnit: c.suppUnit,
      missing: !p.hsCode || !pk.netWeightKg || !p.originCountryCode,
      proposal: last ? { id: last.id, status: last.status, cn: last.cnCode, netKg: last.netWeightKg?.toString() ?? null, supp: last.suppUnits?.toString() ?? null, origin: last.originCountryCode, reviewNote: last.reviewNote, at: last.createdAt.toISOString() } : null,
    });
  }
  return { enabled: s.enabled && s.codes.supplierProposals, rows: rows.sort((a, b) => Number(b.missing) - Number(a.missing) || a.name.localeCompare(b.name)) };
}

export async function proposeCustoms(ctx: Ctx, i: { productId: string; packagingUnitId?: string | null; cnCode?: string | null; netWeightKg?: number | null; suppUnits?: number | null; originCountryCode?: string | null; note?: string | null }) {
  supplierOnly(ctx, ["vendor.products.manage"]);
  const s = await tradeSettings();
  if (!s.enabled || !s.codes.supplierProposals) throw new ForbiddenError();
  const offer = await prisma.vendorOffer.findFirst({ where: { vendorCompanyId: ctx.company.id, packaging: { variant: { productId: i.productId }, ...(i.packagingUnitId ? { id: i.packagingUnitId } : {}) } }, select: { packagingUnitId: true, packaging: { select: { variant: { select: { product: { select: { name: true } } } } } } } });
  if (!offer) throw new NotFoundError();
  const cn = cnInput(i.cnCode);
  const kg = kgInput(i.netWeightKg, "Net mass");
  const supp = kgInput(i.suppUnits, "Supplementary units");
  const origin = await countryInput(i.originCountryCode);
  if (!cn && !kg && !supp && !origin) throw new ValidationError("Fill in at least one value.");
  const pid = i.packagingUnitId ?? offer.packagingUnitId;
  const x = await prisma.$transaction(async (tx) => {
    await tx.tradeCodeProposal.updateMany({ where: { companyId: ctx.company.id, productId: i.productId, packagingUnitId: pid, status: "PENDING" }, data: { status: "REJECTED", reviewNote: "Replaced by a newer proposal." } });
    return tx.tradeCodeProposal.create({ data: { productId: i.productId, packagingUnitId: pid, companyId: ctx.company.id, cnCode: cn, netWeightKg: kg, suppUnits: supp, originCountryCode: origin, note: i.note?.trim().slice(0, 500) || null, createdById: ctx.user.id } });
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "trade.code_proposed", entityType: "TradeCodeProposal", entityId: x.id, after: { productId: i.productId, cn, kg, supp, origin } });
  await notify("trade.code_review", [{ companyId: await firingiId(), link: "/admin/invoices/eu-trade/codes" }], { company: ctx.company.tradeName ?? ctx.company.legalName, product: pick(offer.packaging.variant.product.name) }, { ref: { type: "TradeCodeProposal", id: x.id } }).catch(() => null);
  return x;
}

/**
 * The supplier's own EU report: what FIRINGI bought from it across a border in a period — its intra-EU supplies
 * to FIRINGI (for its EC Sales List) and the goods lines (for its Intrastat dispatches). Credits subtract.
 */
export async function supplierReport(ctx: Ctx, period: string, locale: string) {
  supplierOnly(ctx, ["vendor.reports.view", "vendor.invoices.view", "vendor.orders.view"]);
  const s = await tradeSettings();
  if (!s.enabled || !s.returns.supplierReports) throw new ForbiddenError();
  if (!isPeriod(period)) throw new ValidationError("Use a period like 2026-11 or 2026-Q4.");
  const { start, end } = periodRange(period);
  const sts = await prisma.vendorBillingStatement.findMany({
    where: { vendorCompanyId: ctx.company.id, taxRegime: "INTRA_EU_REVERSE_CHARGE", createdAt: { gte: start, lt: end } },
    include: { salesInvoice: { select: { legalEntity: { select: { legalName: true, vatNumber: true, country: { select: { code: true } } } } } }, order: { select: { number: true } } },
    orderBy: { createdAt: "asc" },
  });
  const lines: TradeLine[] = [];
  const goodsLines: TradeLine[] = [];
  for (const st of sts) {
    const le = st.salesInvoice?.legalEntity;
    if (!le) continue;
    const sign = st.isCreditStatement ? -1 : 1;
    const vat = vatWithPrefix(le.vatNumber, le.country.code);
    const ls = st.lines as { orderLineId: string | null; sku: string; qty: number; lineNet: string; description: string }[];
    const ols = await prisma.orderLine.findMany({ where: { id: { in: ls.map((l) => l.orderLineId).filter(Boolean) as string[] } }, select: { id: true, qtyDelivered: true, qtyConfirmed: true, qtyOrdered: true, cwBilledKg: true, ...OFFER_SELECT } });
    for (const l of ls) {
      const base: TradeLine = {
        partnerCountry: le.country.code, partnerVat: vat, partnerName: le.legalName, indicator: "GOODS", cnCode: null, description: l.description, originCountry: null,
        netMassKg: null, suppQty: null, suppUnit: null, value: sign * Math.abs(Number(l.lineNet)), natureCode: null, transportMode: null, deliveryTerms: null, correctsPeriod: null, sourceNumber: st.selfBilledNumber ?? st.number,
      };
      lines.push(base);
      const ol = l.orderLineId && !l.sku.startsWith("EXCISE-") && l.sku !== "DELIVERY" ? ols.find((o) => o.id === l.orderLineId) : null;
      if (!ol) continue;
      const c = await customsOf({ product: ol.offer.packaging.variant.product, packaging: ol.offer.packaging }, s);
      const delivered = ol.qtyDelivered ?? ol.qtyConfirmed ?? ol.qtyOrdered;
      const mass = ol.cwBilledKg != null ? D(ol.cwBilledKg).mul(delivered ? Math.abs(l.qty) / delivered : 1) : c.netKgPerPack ? c.netKgPerPack.mul(Math.abs(l.qty)) : null;
      goodsLines.push({
        ...base, cnCode: c.cn, originCountry: c.origin, netMassKg: mass ? sign * mass.toDecimalPlaces(3).toNumber() : null,
        suppQty: c.suppPerPack ? sign * c.suppPerPack.mul(Math.abs(l.qty)).toDecimalPlaces(3).toNumber() : null, suppUnit: c.suppUnit,
        natureCode: sign < 0 ? "21" : s.defaults.natureCode, transportMode: s.defaults.transportMode, deliveryTerms: s.defaults.deliveryTerms,
      });
    }
  }
  void locale;
  return { period, lines, ecsl: genericTable("ECSL", lines, s.defaults), intrastat: genericTable("DISPATCHES", goodsLines, s.defaults), total: lines.reduce((a, l) => a + l.value, 0) };
}

export async function supplierReportFile(ctx: Ctx, period: string, kind: "ECSL" | "DISPATCHES", fmt: "csv" | "xlsx", locale: string) {
  const r = await supplierReport(ctx, period, locale);
  const t = kind === "ECSL" ? r.ecsl : r.intrastat;
  const base = `FIRINGI_${kind === "ECSL" ? "ec-sales-list" : "intrastat-dispatches"}_${period}`;
  if (fmt === "xlsx") {
    const { toXlsx } = await import("@/server/integrations/accounting");
    return { fileName: `${base}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: await toXlsx([t as never], base) as string | Buffer };
  }
  const { csv } = await import("@/lib/trade");
  return { fileName: `${base}.csv`, contentType: "text/csv; charset=utf-8", body: csv(t.headers, t.rows) as string | Buffer };
}

/** Periods with something in them for a supplier (last 18 months). */
export async function supplierPeriods(ctx: Ctx) {
  supplierOnly(ctx, ["vendor.reports.view", "vendor.invoices.view", "vendor.orders.view"]);
  const since = new Date(Date.UTC(new Date().getUTCFullYear() - 1, new Date().getUTCMonth() - 6, 1));
  const sts = await prisma.vendorBillingStatement.findMany({ where: { vendorCompanyId: ctx.company.id, taxRegime: "INTRA_EU_REVERSE_CHARGE", createdAt: { gte: since } }, select: { createdAt: true } });
  const months = new Set(sts.map((x) => periodOf(x.createdAt, "MONTHLY")));
  months.add(periodOf(new Date(), "MONTHLY"));
  return [...months].sort().reverse();
}

/** FIRINGI's entities (for opening a period). */
export async function tradeEntities(ctx: Ctx) {
  staffOnly(ctx, false);
  return (await entities()).map((e) => ({ id: e.id, label: `${e.country.code} · ${e.legalName}` }));
}

/** The settings page: settings and the EU countries (those with a FIRINGI entity first). */
export async function tradeSettingsPage(ctx: Ctx) {
  if (!isStaff(ctx) || !can(ctx, ["admin.settings.view", "admin.settings.manage", "admin.tax.manage"])) throw new ForbiddenError();
  const [s, cs] = await Promise.all([tradeSettings(), prisma.country.findMany({ where: { isEU: true, isActive: true }, select: { code: true, name: true, legalEntities: { where: { isActive: true }, select: { id: true } } }, orderBy: { code: "asc" } })]);
  const countries = cs.map((c) => ({ code: c.code, name: pick(c.name), hasEntity: c.legalEntities.length > 0 })).sort((a, b) => Number(b.hasEntity) - Number(a.hasEntity) || a.code.localeCompare(b.code));
  return { settings: s, countries };
}
