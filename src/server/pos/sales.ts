/**
 * Phase 47 — a till sale and a refund. The same function stores a sale made online and one sent later by a till
 * that was offline (once only: the till's own id for the sale). The server recomputes every amount with the shared
 * maths; stock goes down FEFO (a supplier's own products from the till's warehouse; a restaurant's recipes from
 * the ingredients it bought on FIRINGI), the business's loyalty points move, the receipt joins the register's hash
 * chain and — in a country on a certified provider — goes to the business's provider.
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import Decimal from "decimal.js";
import type { PosPaymentMethod } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { issue, receive } from "@/server/inventory/ledger";
import { accrue, hashInput, packsOf, pointsFor, pointsValue, receiptNumber, saleTotals, settle } from "@/lib/pos";
import { requirePos, type PosAccess } from "./settings";
import { fiscalize, kickPosQueue } from "./fiscal";
import { tillAccess } from "./access";
import { writeAudit } from "@/server/services/audit";
import { checkTaxId, PT_FINAL_CONSUMER } from "@/lib/tax-id";

export type SaleLineInput = { itemId?: string | null; name?: string | null; qty: number; unitPrice: number; discountPct?: number; vatRate?: number | null };
export type SaleInput = {
  clientId: string; registerId: string; shiftId: string; n: number; soldAt: string;
  lines: SaleLineInput[]; saleDiscountPct?: number;
  payments: { method: PosPaymentMethod; amount: number; tendered?: number | null; ref?: string | null }[];
  customerTaxId?: string | null; customerName?: string | null; customerEmail?: string | null;
  memberId?: string | null; pointsUsed?: number; ageChecked?: boolean; tableRef?: string | null; note?: string | null;
  approvedById?: string | null; ticketId?: string | null;
};

const D = (v: Decimal.Value) => new Decimal(v || 0);
const token = () => randomBytes(18).toString("base64url");

/** A manager who approved something at the till must be one of the company's people with the till's manage right. */
/** A manager who approved something at the till must manage that till (owner, the till's or the shop's manager). */
async function isManager(companyId: string, userId: string | null | undefined, registerId: string) {
  if (!userId) return false;
  return (await tillAccess(companyId, userId)).manage.has(registerId);
}
export { isManager as isPosManager };

export async function ownRegister(ctx: Ctx, registerId: string, db: Tx = prisma) {
  const r = await db.posRegister.findUnique({ where: { id: registerId } });
  if (!r || r.companyId !== ctx.company.id) throw new NotFoundError("Till not found.");
  if (!(await tillAccess(ctx.company.id, ctx.user.id, db)).sell.has(r.id)) throw new ForbiddenError("You can't use this till.");
  return r;
}

/** A supplier's own product: whole units leave the till's warehouse FEFO (fractions of a pack add up first). */
async function takeOwnStock(tx: Tx, companyId: string, offerId: string, addressId: string, units: Decimal, saleId: string, byUserId: string) {
  const key = { companyId_offerId_addressId: { companyId, offerId, addressId } };
  const acc = await tx.posStockAccrual.findUnique({ where: key });
  const a = accrue(acc?.pending.toString() ?? 0, units.toString());
  await tx.posStockAccrual.upsert({ where: key, update: { pending: a.pending, usedTotal: { increment: units.toString() } }, create: { companyId, offerId, addressId, pending: a.pending, usedTotal: units.toString() } });
  if (!a.whole) return { picks: [], short: 0 };
  const level = await tx.stockLevel.findUnique({ where: { offerId_addressId: { offerId, addressId } } });
  const free = level ? Math.max(0, level.onHand - level.reserved) : 0;
  const take = Math.min(a.whole, free);
  const picks = take > 0 ? await issue(tx, { offerId, addressId, qty: take, type: "SHIPMENT", refType: "POS", refId: saleId, byUserId, note: "Till sale" }) : [];
  return { picks: picks.map((p) => ({ lot: p.lotCode, expiresOn: p.expiresOn?.toISOString().slice(0, 10) ?? null, qty: p.qty })), short: a.whole - take };
}

/** A dish's ingredient bought on FIRINGI: whole packs are marked used, oldest expiry first. */
async function takePurchased(tx: Tx, companyId: string, offerId: string, packs: Decimal, saleId: string, byUserId: string) {
  const key = { companyId_offerId_addressId: { companyId, offerId, addressId: "" } };
  const acc = await tx.posStockAccrual.findUnique({ where: key });
  const a = accrue(acc?.pending.toString() ?? 0, packs.toString());
  await tx.posStockAccrual.upsert({ where: key, update: { pending: a.pending, usedTotal: { increment: packs.toString() } }, create: { companyId, offerId, addressId: "", pending: a.pending, usedTotal: packs.toString() } });
  let left = a.whole;
  const used: { lot: string | null; expiresOn: string | null; qty: number }[] = [];
  if (!left) return { used, short: 0 };
  const lots = await tx.purchasedLot.findMany({ where: { buyerCompanyId: companyId, offerId }, orderBy: [{ expiresOn: "asc" }, { stockedAt: "asc" }] });
  for (const l of lots) {
    if (!left) break;
    let avail = l.qty - l.usedQty;
    if (l.ownBatchId) {
      const b = await tx.stockBatch.findUnique({ where: { id: l.ownBatchId } });
      if (!b) continue;
      avail = Math.min(avail, b.onHand - b.reserved);
      const take = Math.min(left, avail);
      if (take <= 0) continue;
      await issue(tx, { offerId: b.offerId, addressId: b.addressId, batchId: b.id, qty: take, type: "SHIPMENT", refType: "POS", refId: saleId, byUserId, note: "Used in a dish (till)" });
      used.push({ lot: l.lotCode, expiresOn: l.expiresOn?.toISOString().slice(0, 10) ?? null, qty: take });
      left -= take;
      continue;
    }
    const take = Math.min(left, avail);
    if (take <= 0) continue;
    await tx.purchasedLot.update({ where: { id: l.id }, data: { usedQty: { increment: take } } });
    used.push({ lot: l.lotCode, expiresOn: l.expiresOn?.toISOString().slice(0, 10) ?? null, qty: take });
    left -= take;
  }
  return { used, short: left };
}

type StoredSale = Awaited<ReturnType<typeof saleForReceipt>>;

export async function saleForReceipt(id: string) {
  return prisma.posSale.findUniqueOrThrow({ where: { id }, include: { lines: true, payments: true, register: { select: { code: true, name: true } }, member: { select: { name: true, points: true, code: true } } } });
}

/** Store a till sale (online, or sent later by a till that was offline). */
export async function recordSale(ctx: Ctx, input: SaleInput, opts: { offline?: boolean } = {}): Promise<StoredSale> {
  const offline = !!opts.offline;
  const access = await requirePos(ctx, "sell");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.clientId)) throw new ValidationError("Bad sale id.");
  const register = await ownRegister(ctx, input.registerId);
  const done = await prisma.posSale.findUnique({ where: { registerId_clientId: { registerId: register.id, clientId: input.clientId } }, select: { id: true } });
  if (done) return saleForReceipt(done.id);
  const taxId = customerTaxIdFor(input.customerTaxId, access.countryCode, offline);
  if (!register.active && !offline) throw new ValidationError("This till is switched off.");
  if (access.blocked && !offline) throw new ValidationError("Your country's receipts must go through your certified provider: connect your account in the till settings first.");
  const shift = await prisma.posShift.findUnique({ where: { id: input.shiftId } });
  if (!shift || shift.registerId !== register.id) throw new ValidationError("The shift doesn't belong to this till.");
  if (shift.status !== "OPEN" && !offline) throw new ValidationError("The shift is closed: open a new shift.");
  if (!input.lines.length) throw new ValidationError("The sale has no items.");
  const s = access.settings;
  const pc = access.company;
  const soldAt = Number.isNaN(Date.parse(input.soldAt)) ? new Date() : new Date(input.soldAt);
  if (soldAt.getTime() > Date.now() + 5 * 60_000) throw new ValidationError("The sale's time is in the future.");

  // the items as the till sold them (online: today's prices; offline: what the guest paid)
  const ids = [...new Set(input.lines.map((l) => l.itemId).filter(Boolean) as string[])];
  const items = await prisma.posItem.findMany({ where: { id: { in: ids }, companyId: ctx.company.id }, include: { recipe: true } });
  const byId = new Map(items.map((i) => [i.id, i]));
  const manage = (await tillAccess(ctx.company.id, ctx.user.id)).manage.has(register.id);
  const approved = input.approvedById ? await isManager(ctx.company.id, input.approvedById, register.id) : false;
  if (input.approvedById && !approved) throw new ForbiddenError("The approval must come from a manager of the till.");
  const lines = input.lines.map((l) => {
    const it = l.itemId ? byId.get(l.itemId) : null;
    if (l.itemId && !it) throw new ValidationError("An item isn't on this till any more.");
    if (it && it.registerIds.length && !it.registerIds.includes(register.id) && !offline) throw new ValidationError(`${it.name} isn't sold at this till.`);
    if (!(l.qty > 0) || l.qty > 100_000) throw new ValidationError("Check the quantities.");
    if (!it && !manage && !approved && !offline) throw new ForbiddenError("A free-text item needs a manager.");
    const price = it && !offline ? Number(it.price) : l.unitPrice;
    if (!(price >= 0)) throw new ValidationError("Check the prices.");
    const vatRate = it ? Number(it.vatRate) : Number(l.vatRate ?? NaN);
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 50) throw new ValidationError("A free-text item needs its VAT rate.");
    return { item: it, name: (it?.name ?? l.name ?? "").trim().slice(0, 120) || "—", qty: l.qty, unitPrice: price, discountPct: l.discountPct ?? 0, vatRate };
  });
  const maxDisc = Math.max(input.saleDiscountPct ?? 0, ...lines.map((l) => l.discountPct));
  if (maxDisc > Number(pc?.discountLimit ?? 10) && !manage && !approved && !offline) throw new ForbiddenError("This discount needs a manager's PIN.");
  if (s.features.ageCheck && lines.some((l) => l.item?.restriction) && !input.ageChecked && !offline) throw new ValidationError("Check the guest's age for alcohol / tobacco.");

  const totals = saleTotals(lines, input.saleDiscountPct ?? 0, access.decimals);
  // loyalty: points paid must match the points used
  const member = input.memberId ? await prisma.posMember.findFirst({ where: { id: input.memberId, companyId: ctx.company.id } }) : null;
  if (input.memberId && !member) throw new ValidationError("Loyalty card not found.");
  const pointsUsed = Math.max(0, Math.floor(input.pointsUsed ?? 0));
  const pointsPay = input.payments.filter((p) => p.method === "POINTS").reduce((a, p) => a.plus(p.amount), D(0));
  if (pointsUsed || pointsPay.gt(0)) {
    if (!member || !pc?.loyaltyOn || !s.features.loyalty) throw new ValidationError("Points can only pay with a loyalty card.");
    if (!pointsPay.eq(D(pointsValue(pointsUsed, pc.pointValue.toString(), access.decimals)))) throw new ValidationError("The points don't match their value.");
    if (!offline && (pointsUsed < pc.minRedeem || pointsUsed > member.points)) throw new ValidationError(`Points can be used from ${pc.minRedeem}; the card has ${member.points}.`);
  }
  for (const p of input.payments) {
    if (!(p.amount >= 0)) throw new ValidationError("Check the payments.");
    const off = (p.method === "CASH" && !s.features.cash) || (p.method === "CARD" && !s.features.card) || (p.method === "MBWAY" && !s.features.mbway);
    if (off && !offline) throw new ValidationError("This payment method is switched off.");
  }
  const st = settle(totals.gross, input.payments, access.decimals);
  const notes = [input.note?.slice(0, 300)];
  if (st.over && !offline) throw new ValidationError("Card / other payments are more than the total.");
  if (D(st.due).gt(0)) {
    if (!offline) throw new ValidationError(`Still to pay: ${st.due}.`);
    notes.push(`Paid ${st.paid} of ${totals.gross} (sent offline).`);
  }

  const base = receiptNumber(register.code, shift.number, Math.max(1, Math.floor(input.n)));
  const taken = await prisma.posSale.findUnique({ where: { registerId_number: { registerId: register.id, number: base } }, select: { id: true } });
  const number = taken ? `${base}-${input.clientId.slice(-4)}` : base;
  const stage = access.stage;
  const addressId = register.addressId ?? (await prisma.address.findFirst({ where: { companyId: ctx.company.id, isActive: true, kind: { in: ["WAREHOUSE", "PICKUP"] } }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id ?? null;

  const saleId = await prisma.$transaction(async (tx) => {
    // the register's chain, one sale at a time
    await tx.$queryRaw`SELECT id FROM "PosRegister" WHERE id = ${register.id} FOR UPDATE`;
    const reg = await tx.posRegister.findUniqueOrThrow({ where: { id: register.id }, select: { lastHash: true } });
    const hash = createHash("sha256").update(hashInput(reg.lastHash, { number, soldAt: soldAt.toISOString(), gross: totals.gross, lines: lines.map((l, i) => ({ name: l.name, qty: totals.lines[i].qty, gross: totals.lines[i].gross })) })).digest("hex");
    const paidMoney = D(totals.gross).minus(pointsPay);
    const earned = member && pc?.loyaltyOn && s.features.loyalty ? pointsFor(Decimal.max(0, paidMoney).toString(), pc.pointsPerUnit.toString()) : 0;
    const sale = await tx.posSale.create({
      data: {
        companyId: ctx.company.id, registerId: register.id, shiftId: shift.id, clientId: input.clientId, number, kind: "SALE", currency: access.currency,
        net: totals.net, vat: totals.vat, gross: totals.gross, discount: totals.discount, cashierId: ctx.user.id, approvedById: approved ? input.approvedById : null,
        soldAt, offline, ageChecked: !!input.ageChecked, customerTaxId: taxId, customerName: input.customerName?.trim().slice(0, 120) || null,
        customerEmail: input.customerEmail?.trim().slice(0, 200) || null, memberId: member?.id ?? null, pointsEarned: earned, pointsUsed,
        tableRef: input.tableRef?.slice(0, 40) || null, note: notes.filter(Boolean).join(" ") || null,
        fiscalStage: stage, fiscalStatus: stage === "PROVIDER" ? "PENDING" : "NOT_REQUIRED", fiscalProvider: stage === "PROVIDER" ? access.provider : null,
        prevHash: reg.lastHash, hash, receiptToken: token(),
        payments: {
          create: input.payments.filter((p) => p.amount > 0 || p.method === "CASH").map((p) => p.method === "CASH"
            ? { method: p.method, amount: st.cashKept, tendered: p.tendered ?? p.amount, change: st.change, ref: p.ref?.slice(0, 80) || null }
            : { method: p.method, amount: p.amount, ref: p.ref?.slice(0, 80) || null }),
        },
      },
    });
    await tx.posRegister.update({ where: { id: register.id }, data: { lastHash: hash } });
    // lines and their stock
    for (const [i, l] of lines.entries()) {
      const t = totals.lines[i];
      const lots: Record<string, unknown> = {};
      if (l.item?.offerId && addressId && access.type !== "CUSTOMER") {
        const r = await takeOwnStock(tx, ctx.company.id, l.item.offerId, addressId, D(l.qty).mul(l.item.stockPerUnit.toString()), sale.id, ctx.user.id);
        if (r.picks.length) lots.picks = r.picks;
        if (r.short) lots.short = r.short;
      }
      if (l.item?.recipe.length && s.features.recipes) {
        const used: unknown[] = [];
        for (const rl of l.item.recipe) {
          const offer = await tx.vendorOffer.findUnique({ where: { id: rl.offerId }, select: { packaging: { select: { netWeightKg: true, unitsPerPack: true } } } });
          if (!offer) continue;
          const packs = packsOf(D(rl.qty).mul(l.qty).toString(), rl.unit, { netWeightKg: offer.packaging.netWeightKg?.toString() ?? null, unitsPerPack: offer.packaging.unitsPerPack });
          const r = await takePurchased(tx, ctx.company.id, rl.offerId, packs, sale.id, ctx.user.id);
          if (r.used.length || r.short) used.push({ offerId: rl.offerId, used: r.used, short: r.short });
        }
        if (used.length) lots.recipe = used;
      }
      await tx.posSaleLine.create({ data: { saleId: sale.id, itemId: l.item?.id ?? null, name: l.name, qty: t.qty, byWeight: !!l.item?.byWeight, unitPrice: t.unitPrice, discountPct: t.discountPct, vatRate: t.vatRate, net: t.net, vat: t.vat, gross: t.gross, lots: Object.keys(lots).length ? (lots as never) : undefined } });
    }
    if (member && (earned || pointsUsed)) {
      await tx.posMember.update({ where: { id: member.id }, data: { points: { increment: earned - pointsUsed } } });
      if (pointsUsed) await tx.posPointsEntry.create({ data: { memberId: member.id, saleId: sale.id, points: -pointsUsed, reason: `Paid with points (${number})` } });
      if (earned) await tx.posPointsEntry.create({ data: { memberId: member.id, saleId: sale.id, points: earned, reason: `Earned (${number})` } });
    }
    if (input.ticketId) await tx.posOpenTicket.deleteMany({ where: { id: input.ticketId, register: { companyId: ctx.company.id } } });
    return sale.id;
  });

  if (stage === "PROVIDER") {
    // online: the legal receipt number comes back with the sale; otherwise it follows on the e-receipt
    if (!offline) await Promise.race([fiscalize(saleId), new Promise((r) => setTimeout(r, 8000))]).catch(() => null);
    else kickPosQueue();
  }
  const sale = await saleForReceipt(saleId);
  if (sale.customerEmail && pc?.emailReceipts !== false && s.features.emailReceipt) void emailReceipt(sale.id).catch(() => null);
  return sale;
}

/** E-mail a receipt: the text and the link to the receipt page (QR on paper). */
export async function emailReceipt(saleId: string, to?: string) {
  const s = await saleForReceipt(saleId);
  const addr = to ?? s.customerEmail;
  if (!addr || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) throw new ValidationError("Enter a valid e-mail address.");
  const co = await prisma.company.findUniqueOrThrow({ where: { id: s.companyId }, select: { tradeName: true, legalName: true, country: { select: { code: true } } } });
  const base = process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const vatWord = ({ PT: "IVA", ES: "IVA", IT: "IVA", FR: "TVA", BE: "TVA", LU: "TVA", DE: "MwSt.", AT: "USt.", NL: "btw", PL: "VAT" } as Record<string, string>)[co.country?.code ?? ""] ?? "VAT";
  const { sendMail } = await import("@/server/services/mailer");
  await sendMail({
    to: addr, subject: `${co.tradeName ?? co.legalName} — ${s.fiscalNumber ?? s.number}`,
    text: [`${co.tradeName ?? co.legalName}`, `${s.fiscalNumber ?? s.number} · ${s.soldAt.toISOString().slice(0, 16).replace("T", " ")}`, "",
      ...(s.customerTaxId ? [`NIF: ${s.customerTaxId}${s.customerName ? ` · ${s.customerName}` : ""}`, ""] : []),
      ...s.lines.map((l) => `${l.qty} × ${l.name}  (${vatWord} ${Number(l.vatRate)}%)  ${l.gross.toFixed(2)} ${s.currency}`), "",
      ...vatRows(s.lines).map((r) => `${vatWord} ${r.rate}%: ${r.net.toFixed(2)} + ${r.vat.toFixed(2)} = ${r.gross.toFixed(2)} ${s.currency}`),
      `${s.net.toFixed(2)} + ${vatWord} ${s.vat.toFixed(2)}`, `TOTAL ${s.gross.toFixed(2)} ${s.currency}`, "", `${base}/r/${s.receiptToken}`].join("\n"),
  });
  if (to && to !== s.customerEmail) await prisma.posSale.update({ where: { id: s.id }, data: { customerEmail: to } });
  return { ok: true };
}

/** The customer's NIF on a receipt: checked (Portugal's digits), stored normalised; the final-consumer number = none. */
function customerTaxIdFor(raw: string | null | undefined, country: string, offline: boolean) {
  const v = raw?.trim();
  if (!v) return null;
  const c = checkTaxId(v, country);
  if (c.ok) return c.value === PT_FINAL_CONSUMER ? null : c.value;
  if (offline) return v.slice(0, 32); // already on the customer's paper receipt — keep what was printed
  throw new ValidationError(c.reason === "checksum" ? "This NIF isn't valid — check the digits." : "Check the customer's tax number (NIF).");
}

/** VAT by rate from a receipt's lines (net + VAT = gross). */
function vatRows(lines: { vatRate: Decimal.Value; net: Decimal.Value; vat: Decimal.Value; gross: Decimal.Value }[]) {
  const m = new Map<string, { rate: string; net: Decimal; vat: Decimal; gross: Decimal }>();
  for (const l of lines) { const k = new Decimal(l.vatRate).toString(); const x = m.get(k) ?? { rate: k, net: new Decimal(0), vat: new Decimal(0), gross: new Decimal(0) }; m.set(k, { rate: k, net: x.net.plus(l.net), vat: x.vat.plus(l.vat), gross: x.gross.plus(l.gross) }); }
  return [...m.values()].sort((a, b) => Number(b.rate) - Number(a.rate));
}

/** Put the customer's NIF (and name) on a receipt after the sale — only while it isn't certified yet. */
export async function setSaleTaxId(ctx: Ctx, saleId: string, raw: string, name?: string | null) {
  const access = await requirePos(ctx, "sell");
  const sale = await prisma.posSale.findUnique({ where: { id: saleId }, select: { id: true, companyId: true, registerId: true, kind: true, fiscalNumber: true, fiscalStatus: true, customerTaxId: true } });
  if (!sale || sale.companyId !== ctx.company.id) throw new NotFoundError("Sale not found.");
  await ownRegister(ctx, sale.registerId);
  if (sale.kind !== "SALE") throw new ValidationError("Add the NIF on the sale, not on a refund.");
  if (sale.fiscalNumber || sale.fiscalStatus === "DONE") throw new ValidationError("This receipt is already certified — the NIF can't be added any more. Refund it and sell again with the NIF.");
  const taxId = customerTaxIdFor(raw, access.countryCode, false);
  if (!taxId) throw new ValidationError("Enter the customer's NIF.");
  const updated = await prisma.posSale.update({ where: { id: sale.id }, data: { customerTaxId: taxId, customerName: name?.trim().slice(0, 120) || undefined } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pos.sale.tax_id", entityType: "PosSale", entityId: sale.id, before: { customerTaxId: sale.customerTaxId }, after: { customerTaxId: taxId } });
  return { id: updated.id, customerTaxId: updated.customerTaxId, customerName: updated.customerName };
}

export type RefundInput = { clientId: string; saleId: string; registerId: string; shiftId: string; n: number; lines: { lineId: string; qty: number }[]; method: PosPaymentMethod; reason: string; restock?: boolean; approvedById?: string | null };

/** Give money back for some or all of a sale (online). Within the business's refund days; a manager for cashiers. */
export async function refundSale(ctx: Ctx, input: RefundInput) {
  const access = await requirePos(ctx, "sell");
  const register = await ownRegister(ctx, input.registerId);
  const done = await prisma.posSale.findUnique({ where: { registerId_clientId: { registerId: register.id, clientId: input.clientId } }, select: { id: true } });
  if (done) return saleForReceipt(done.id);
  const orig = await prisma.posSale.findUnique({ where: { id: input.saleId }, include: { lines: true, payments: true, refunds: { include: { lines: true } } } });
  if (!orig || orig.companyId !== ctx.company.id || orig.kind !== "SALE") throw new NotFoundError("Sale not found.");
  const manage = (await tillAccess(ctx.company.id, ctx.user.id)).manage.has(register.id);
  const approved = input.approvedById ? await isManager(ctx.company.id, input.approvedById, register.id) : false;
  if (!manage && !approved) throw new ForbiddenError("A refund needs a manager's PIN.");
  const days = access.company?.refundDays ?? 30;
  if (orig.soldAt.getTime() < Date.now() - days * 86_400_000) throw new ValidationError(`Sales can be refunded within ${days} days.`);
  if (!input.reason?.trim()) throw new ValidationError("Give a reason for the refund.");
  const shift = await prisma.posShift.findUnique({ where: { id: input.shiftId } });
  if (!shift || shift.registerId !== register.id || shift.status !== "OPEN") throw new ValidationError("Open a shift on this till first.");
  const back = new Map<string, Decimal>();
  for (const r of orig.refunds) for (const l of r.lines) { const src = (l.lots as { from?: string } | null)?.from; if (src) back.set(src, (back.get(src) ?? D(0)).plus(l.qty.toString())); }
  const chosen = input.lines.filter((l) => l.qty > 0).map((l) => {
    const ol = orig.lines.find((x) => x.id === l.lineId);
    if (!ol) throw new ValidationError("A line isn't on this sale.");
    const left = D(ol.qty.toString()).minus(back.get(ol.id) ?? 0);
    if (D(l.qty).gt(left)) throw new ValidationError(`Only ${left.toString()} of ${ol.name} can still be refunded.`);
    return { ol, qty: l.qty };
  });
  if (!chosen.length) throw new ValidationError("Choose what to refund.");
  // the refund repeats the sale's prices and discounts, proportionally
  const lines = chosen.map(({ ol, qty }) => {
    const share = D(qty).div(ol.qty.toString());
    const gross = D(ol.gross.toString()).mul(share).toDecimalPlaces(access.decimals, Decimal.ROUND_HALF_UP);
    const net = gross.div(D(1).plus(D(ol.vatRate.toString()).div(100))).toDecimalPlaces(access.decimals, Decimal.ROUND_HALF_UP);
    return { ol, qty, gross, net, vat: gross.minus(net) };
  });
  const gross = lines.reduce((a, l) => a.plus(l.gross), D(0)), net = lines.reduce((a, l) => a.plus(l.net), D(0));
  const n = Math.max(1, Math.floor(input.n));
  const base = receiptNumber(register.code, shift.number, n);
  const taken = await prisma.posSale.findUnique({ where: { registerId_number: { registerId: register.id, number: base } }, select: { id: true } });
  const number = taken ? `${base}-${input.clientId.slice(-4)}` : base;
  const stage = orig.fiscalStage === "PROVIDER" && access.stage === "PROVIDER" ? "PROVIDER" : "NONFISCAL";
  const id = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PosRegister" WHERE id = ${register.id} FOR UPDATE`;
    const reg = await tx.posRegister.findUniqueOrThrow({ where: { id: register.id }, select: { lastHash: true, addressId: true } });
    const soldAt = new Date();
    const hash = createHash("sha256").update(hashInput(reg.lastHash, { number, soldAt: soldAt.toISOString(), gross: `-${gross.toFixed(access.decimals)}`, lines: lines.map((l) => ({ name: l.ol.name, qty: String(l.qty), gross: l.gross.toFixed(access.decimals) })) })).digest("hex");
    // points: the share of what the sale earned goes back; points it was paid with come back too
    const share = gross.div(orig.gross.toString());
    const pointsBack = Math.floor(D(orig.pointsEarned).mul(share).toNumber());
    const refund = await tx.posSale.create({
      data: {
        companyId: ctx.company.id, registerId: register.id, shiftId: shift.id, clientId: input.clientId, number, kind: "REFUND", refundOfId: orig.id, currency: orig.currency,
        net: net.toFixed(2), vat: gross.minus(net).toFixed(2), gross: gross.toFixed(2), cashierId: ctx.user.id, approvedById: approved ? input.approvedById : null, soldAt,
        memberId: orig.memberId, pointsEarned: -pointsBack, note: input.reason.trim().slice(0, 300), customerTaxId: orig.customerTaxId,
        fiscalStage: stage, fiscalStatus: stage === "PROVIDER" ? "PENDING" : "NOT_REQUIRED", fiscalProvider: stage === "PROVIDER" ? access.provider : null,
        prevHash: reg.lastHash, hash, receiptToken: token(),
        payments: { create: [{ method: input.method, amount: gross.toFixed(2) }] },
      },
    });
    await tx.posRegister.update({ where: { id: register.id }, data: { lastHash: hash } });
    for (const l of lines) {
      const lots: Record<string, unknown> = { from: l.ol.id };
      const item = l.ol.itemId ? await tx.posItem.findUnique({ where: { id: l.ol.itemId } }) : null;
      if (input.restock && item?.offerId && reg.addressId && access.type !== "CUSTOMER") {
        const units = Math.floor(D(l.qty).mul(item.stockPerUnit.toString()).toNumber());
        if (units > 0) {
          const level = await tx.stockLevel.findUnique({ where: { offerId_addressId: { offerId: item.offerId, addressId: reg.addressId } } });
          await receive(tx, { offerId: item.offerId, addressId: reg.addressId, qty: units, unitCost: level?.avgCost ?? 0, source: "RETURN", type: "RETURN", refType: "POS", refId: refund.id, byUserId: ctx.user.id, note: "Till refund back to stock" });
          lots.restocked = units;
        }
      }
      await tx.posSaleLine.create({ data: { saleId: refund.id, itemId: l.ol.itemId, name: l.ol.name, qty: String(l.qty), byWeight: l.ol.byWeight, unitPrice: l.ol.unitPrice, discountPct: l.ol.discountPct, vatRate: l.ol.vatRate, net: l.net.toFixed(2), vat: l.vat.toFixed(2), gross: l.gross.toFixed(2), lots: lots as never } });
    }
    if (orig.memberId && pointsBack) {
      await tx.posMember.update({ where: { id: orig.memberId }, data: { points: { decrement: pointsBack } } });
      await tx.posPointsEntry.create({ data: { memberId: orig.memberId, saleId: refund.id, points: -pointsBack, reason: `Refund (${number})` } });
    }
    return refund.id;
  });
  if (stage === "PROVIDER") await Promise.race([fiscalize(id), new Promise((r) => setTimeout(r, 8000))]).catch(() => null);
  return saleForReceipt(id);
}

/** The receipt page behind the QR code (no login: the long random token is the key). */
export async function publicReceipt(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const s = await prisma.posSale.findUnique({ where: { receiptToken: token }, include: { lines: true, payments: true, register: { select: { code: true } }, refundOf: { select: { number: true, fiscalNumber: true } } } });
  if (!s) return null;
  const co = await prisma.company.findUniqueOrThrow({ where: { id: s.companyId }, select: { legalName: true, tradeName: true, taxId: true, vatNumber: true, country: { select: { code: true, defaultLanguageCode: true } }, posCompany: { select: { receiptHeader: true, receiptFooter: true } } } });
  return { sale: s, company: co };
}

export type ReceiptSale = StoredSale;
export type _Access = PosAccess;
