/**
 * Payments & credit control (FIRINGI is the seller; buyers pay FIRINGI).
 *   • Payment methods shown to buyers (bank transfer with FIRINGI's IBAN, MB WAY, …) and
 *     default payment terms / credit limits for newly approved buyers.
 *   • Credit control at checkout: a buyer can't order when invoices are overdue for longer than
 *     the grace period, or when open invoices + open orders + this order exceed its credit limit.
 * Buyer exposure = unpaid invoices (gross − paid − credited) + orders not yet invoiced.
 */
import type { CompanyType } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, ValidationError } from "@/server/errors";
import { scopeWhere } from "./admin-access";
import { writeAudit } from "./audit";

const KEY = "payments.policy";
export const METHODS = ["BANK_TRANSFER", "MB_WAY", "MULTIBANCO", "DIRECT_DEBIT", "CARD", "CASH_ON_DELIVERY"] as const;
export type Method = (typeof METHODS)[number];
type BuyerType = "CUSTOMER" | "WHOLESALER";

export type PaymentPolicy = {
  methods: Record<Method, boolean>;
  /** MB WAY number buyers send money to (manual MB WAY). */
  mbWayPhone: string | null;
  /** Block new orders when an invoice is overdue for more than this many days (null = never). */
  overdueBlockDays: number | null;
  /** Enforce credit limits at checkout. */
  creditCheck: boolean;
  /** Applied when a buyer is approved (its own values can be changed later). */
  defaultTermsDays: Record<BuyerType, number>;
  defaultCreditLimit: Record<BuyerType, number | null>;
};

export const DEFAULT_PAYMENTS: PaymentPolicy = {
  methods: { BANK_TRANSFER: true, MB_WAY: false, MULTIBANCO: false, DIRECT_DEBIT: false, CARD: false, CASH_ON_DELIVERY: false },
  mbWayPhone: null,
  overdueBlockDays: 15,
  creditCheck: true,
  defaultTermsDays: { CUSTOMER: 0, WHOLESALER: 30 },
  defaultCreditLimit: { CUSTOMER: null, WHOLESALER: null },
};

/** Methods that need a payment provider integration (not available yet). */
export const NEEDS_PROVIDER: Method[] = ["MULTIBANCO", "DIRECT_DEBIT", "CARD"];

export async function paymentPolicy(db: Tx | typeof prisma = prisma): Promise<PaymentPolicy> {
  const s = await db.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } } });
  const v = (s?.value ?? {}) as Partial<PaymentPolicy>;
  return {
    ...DEFAULT_PAYMENTS, ...v,
    methods: { ...DEFAULT_PAYMENTS.methods, ...(v.methods ?? {}) },
    defaultTermsDays: { ...DEFAULT_PAYMENTS.defaultTermsDays, ...(v.defaultTermsDays ?? {}) },
    defaultCreditLimit: { ...DEFAULT_PAYMENTS.defaultCreditLimit, ...(v.defaultCreditLimit ?? {}) },
  };
}

export async function setPaymentPolicy(ctx: Ctx, input: PaymentPolicy) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.settings.manage", "admin.finance.manage"])) throw new ForbiddenError();
  const days = (n: unknown, label: string) => { const x = Number(n); if (!Number.isInteger(x) || x < 0 || x > 180) throw new ValidationError(`${label} must be 0–180 days.`); return x; };
  const limit = (n: unknown) => { if (n === null || n === "" || n === undefined) return null; const x = Number(n); if (!Number.isFinite(x) || x < 0) throw new ValidationError("Credit limit must be 0 or more (empty = no limit)."); return x; };
  const methods = Object.fromEntries(METHODS.map((m) => [m, !!input.methods?.[m] && !NEEDS_PROVIDER.includes(m)])) as Record<Method, boolean>;
  if (!Object.values(methods).some(Boolean)) throw new ValidationError("Keep at least one payment method.");
  const phone = input.mbWayPhone?.replace(/\s+/g, "") || null;
  if (methods.MB_WAY && !(phone && /^\+?\d{9,15}$/.test(phone))) throw new ValidationError("Enter the MB WAY phone number.");
  const value: PaymentPolicy = {
    methods, mbWayPhone: phone,
    overdueBlockDays: input.overdueBlockDays === null ? null : days(input.overdueBlockDays, "Grace period"),
    creditCheck: !!input.creditCheck,
    defaultTermsDays: { CUSTOMER: days(input.defaultTermsDays.CUSTOMER, "Customer terms"), WHOLESALER: days(input.defaultTermsDays.WHOLESALER, "Wholesaler terms") },
    defaultCreditLimit: { CUSTOMER: limit(input.defaultCreditLimit.CUSTOMER), WHOLESALER: limit(input.defaultCreditLimit.WHOLESALER) },
  };
  const before = await paymentPolicy();
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    update: { value, updatedById: ctx.user.id }, create: { scope: "GLOBAL", scopeId: "", key: KEY, value, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "setting.payments", entityType: "Setting", entityId: KEY, before, after: value });
  return value;
}

/** Defaults for a buyer that has just been approved (only fills what isn't set yet). */
export async function applyBuyerDefaults(tx: Tx, companyId: string) {
  const c = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { type: true, creditLimit: true, paymentTermsDays: true } });
  if (c.type !== "CUSTOMER" && c.type !== "WHOLESALER") return;
  const p = await paymentPolicy(tx);
  await tx.company.update({
    where: { id: companyId },
    data: {
      ...(c.paymentTermsDays === 0 ? { paymentTermsDays: p.defaultTermsDays[c.type] } : {}),
      ...(c.creditLimit === null && p.defaultCreditLimit[c.type] !== null ? { creditLimit: p.defaultCreditLimit[c.type]! } : {}),
    },
  });
}

const OPEN_ORDER = ["NEW", "ON_HOLD", "PENDING_CONFIRMATION", "SUPPLIER_PROCESSING", "READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "EXCEPTION"] as const;

/** Exposure, overdue and limit of buyers (all, or the given ones). */
export async function creditStatuses(companyIds?: string[]) {
  const now = new Date();
  const where = companyIds ? { id: { in: companyIds } } : { type: { in: ["CUSTOMER", "WHOLESALER"] as CompanyType[] }, status: "APPROVED" as const };
  const companies = await prisma.company.findMany({ where, select: { id: true, legalName: true, tradeName: true, type: true, creditLimit: true, paymentTermsDays: true, country: { select: { code: true } } } });
  const ids = companies.map((c) => c.id);
  if (!ids.length) return [];
  const [invoices, orders, policy] = await Promise.all([
    prisma.invoice.findMany({
      where: { recipientCompanyId: { in: ids }, docType: { in: ["INVOICE", "INVOICE_RECEIPT"] }, status: { not: "DRAFT" } },
      select: { id: true, recipientCompanyId: true, grossTotal: true, dueAt: true, creditNotes: { where: { status: { not: "DRAFT" } }, select: { grossTotal: true } }, allocations: { where: { payment: { status: "CONFIRMED" } }, select: { amount: true } } },
    }),
    prisma.order.groupBy({ by: ["buyerCompanyId"], where: { buyerCompanyId: { in: ids }, status: { in: [...OPEN_ORDER] } }, _sum: { grandTotal: true }, _count: true }),
    paymentPolicy(),
  ]);
  const byCompany = new Map(ids.map((id) => [id, { open: new Decimal(0), overdue: new Decimal(0), oldestDays: 0, invoices: 0 }]));
  for (const i of invoices) {
    const open = new Decimal(i.grossTotal.toString())
      .minus(i.creditNotes.reduce((a, c) => a.plus(c.grossTotal.toString()), new Decimal(0)))
      .minus(i.allocations.reduce((a, x) => a.plus(x.amount.toString()), new Decimal(0)));
    if (open.lte(0.004)) continue;
    const b = byCompany.get(i.recipientCompanyId)!;
    b.open = b.open.plus(open);
    b.invoices++;
    if (i.dueAt && i.dueAt < now) {
      b.overdue = b.overdue.plus(open);
      b.oldestDays = Math.max(b.oldestDays, Math.floor((now.getTime() - i.dueAt.getTime()) / 86400_000));
    }
  }
  const ord = new Map(orders.map((o) => [o.buyerCompanyId, { value: new Decimal(o._sum.grandTotal?.toString() ?? 0), count: o._count }]));
  return companies.map((c) => {
    const b = byCompany.get(c.id)!;
    const o = ord.get(c.id) ?? { value: new Decimal(0), count: 0 };
    const limit = c.creditLimit === null ? null : new Decimal(c.creditLimit.toString());
    const exposure = b.open.plus(o.value);
    const overdueBlocked = policy.overdueBlockDays !== null && b.oldestDays > policy.overdueBlockDays;
    const usage = limit && limit.gt(0) ? exposure.div(limit).toNumber() : limit?.isZero() ? (exposure.gt(0) ? Infinity : 0) : null;
    return {
      id: c.id, name: c.tradeName ?? c.legalName, type: c.type, country: c.country.code, termsDays: c.paymentTermsDays,
      limit: limit?.toNumber() ?? null, openInvoices: b.open.toNumber(), invoiceCount: b.invoices, overdue: b.overdue.toNumber(), oldestOverdueDays: b.oldestDays,
      openOrders: o.value.toNumber(), openOrderCount: o.count, exposure: exposure.toNumber(),
      available: limit === null ? null : limit.minus(exposure).toNumber(), usage,
      status: overdueBlocked ? ("BLOCKED_OVERDUE" as const) : usage !== null && usage >= 1 ? ("AT_LIMIT" as const) : usage !== null && usage >= 0.8 ? ("NEAR_LIMIT" as const) : b.overdue.gt(0) ? ("OVERDUE" as const) : ("OK" as const),
    };
  });
}
export type CreditStatus = Awaited<ReturnType<typeof creditStatuses>>[number];

/** Why this buyer can't place an order of `orderGross` right now (null = it can). */
export async function creditBlock(companyId: string, orderGross: Decimal.Value): Promise<{ code: "PAYMENT_OVERDUE" | "CREDIT_LIMIT"; days?: number; available?: number; limit?: number } | null> {
  const policy = await paymentPolicy();
  const [s] = await creditStatuses([companyId]);
  if (!s) return null;
  if (policy.overdueBlockDays !== null && s.oldestOverdueDays > policy.overdueBlockDays) return { code: "PAYMENT_OVERDUE", days: s.oldestOverdueDays };
  if (policy.creditCheck && s.limit !== null && new Decimal(s.exposure).plus(orderGross).gt(s.limit)) return { code: "CREDIT_LIMIT", available: Math.max(0, s.available ?? 0), limit: s.limit };
  return null;
}

/** Checkout guard (throws). */
export async function assertCanOrder(companyId: string, orderGross: Decimal.Value) {
  const b = await creditBlock(companyId, orderGross);
  if (!b) return;
  if (b.code === "PAYMENT_OVERDUE")
    throw new AppError("PAYMENT_OVERDUE", `You have an invoice overdue for ${b.days} days. Please pay your open invoices before placing new orders.`, 402);
  throw new AppError("CREDIT_LIMIT", `This order is above your available credit (${b.available!.toFixed(2)} € of ${b.limit!.toFixed(2)} €). Pay open invoices or ask FIRINGI to raise your limit.`, 402);
}

/** Back office: payment risk (FIRINGI staff, regional scope applies). */
export async function paymentRisk(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.finance.view", "admin.finance.manage", "admin.risk.view"])) throw new ForbiddenError();
  const ids = (await prisma.company.findMany({ where: { type: { in: ["CUSTOMER", "WHOLESALER"] }, status: { in: ["APPROVED", "SUSPENDED"] }, ...scopeWhere(ctx) }, select: { id: true } })).map((c) => c.id);
  const order = { BLOCKED_OVERDUE: 0, AT_LIMIT: 1, NEAR_LIMIT: 2, OVERDUE: 3, OK: 4 };
  return (await creditStatuses(ids)).sort((a, b) => order[a.status] - order[b.status] || b.exposure - a.exposure);
}

/** How to pay (shown to buyers with their invoices). */
export async function paymentInstructions(countryId: string) {
  const [p, le] = await Promise.all([paymentPolicy(), prisma.legalEntity.findFirst({ where: { countryId, isActive: true } })]);
  return {
    bankTransfer: p.methods.BANK_TRANSFER && le?.iban ? { iban: le.iban, holder: le.legalName } : null,
    mbWay: p.methods.MB_WAY && p.mbWayPhone ? { phone: p.mbWayPhone } : null,
    cashOnDelivery: p.methods.CASH_ON_DELIVERY,
  };
}
