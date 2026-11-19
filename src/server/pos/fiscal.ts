/**
 * Phase 47 — certified receipts. In a country FIRINGI put on a certified provider, each till sale goes to the
 * business's own account with that provider (Moloni in Portugal, a certified cloud fiscalisation service, or the
 * business's fiscal printer / online cash register through a local bridge). Sent right away when online; queued
 * with back-off when offline or when the provider is down; FAILED + alert after 8 tries.
 *
 * Live connections need FIRINGI's agreement with each provider: until then the adapters run simulated
 * (POS_FISCAL_SIMULATE=1, and always in tests) and a live call is refused with a clear message.
 */
import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { can } from "@/server/rbac/guard";
import { writeAudit } from "@/server/services/audit";
import { POS_PROVIDER_INFO, type PosProvider } from "@/lib/pos";
import { unseal } from "./secret";

export type FiscalReceipt = {
  number: string; kind: "SALE" | "REFUND"; soldAt: string; currency: string; gross: string; net: string; vat: string;
  refundOf: string | null; customerTaxId: string | null;
  lines: { name: string; qty: string; unitPrice: string; vatRate: string; gross: string }[];
  payments: { method: string; amount: string }[];
  business: { name: string; taxId: string; country: string };
};
export type FiscalResult = { number: string; ref: string; qr: string | null };

export class FiscalTransient extends Error {}

export const fiscalSimulated = () => process.env.POS_FISCAL_SIMULATE === "1" || process.env.NODE_ENV === "test";

const sig = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16).toUpperCase();

/** One provider call (simulated: account "down" = outage, "reject" = refused). */
async function call(provider: PosProvider, account: string, secret: string, r: FiscalReceipt | null): Promise<FiscalResult> {
  if (!fiscalSimulated()) {
    throw new Error(`${POS_PROVIDER_INFO[provider].name}: the live connection isn't available yet — FIRINGI needs its agreement with this provider. Receipts stay pending.`);
  }
  if (!secret) throw new Error("No secret for the provider account.");
  if (account === "down") throw new FiscalTransient("The provider can't be reached right now.");
  if (account === "reject") throw new Error("The provider refused the receipt: account not authorised.");
  if (!r) return { number: "", ref: "test-ok", qr: null };
  const s = sig(`${provider}|${account}|${r.number}|${r.gross}|${r.soldAt}`);
  const year = r.soldAt.slice(0, 4);
  const n = r.number.split("-").slice(1).join("");
  const doc = r.kind === "REFUND" ? (provider === "moloni" ? "NC" : "STORNO") : provider === "moloni" ? "FS" : provider === "fiscal-device" ? "PAR" : "TSE";
  const number = provider === "moloni" ? `${doc} POS${year}/${Number(n)}` : `${doc} ${s.slice(0, 8)}-${Number(n)}`;
  const qr = provider === "moloni" ? `A:${r.business.taxId}*B:${r.customerTaxId ?? "999999990"}*C:${r.business.country}*D:${doc}*E:N*F:${r.soldAt.slice(0, 10).replace(/-/g, "")}*G:${number}*O:${r.gross}*Q:${s.slice(0, 4)}*R:0000` : `${provider}:${s}`;
  return { number, ref: s, qr };
}

/** The business's connection (decrypted), or null. */
async function connection(companyId: string) {
  const pc = await prisma.posCompany.findUnique({ where: { companyId } });
  if (!pc?.fiscalProvider || !pc.fiscalSecretEnc) return null;
  return { provider: pc.fiscalProvider as PosProvider, account: pc.fiscalAccount ?? "", secret: unseal(pc.fiscalSecretEnc) };
}

export async function testConnection(companyId: string) {
  const c = await connection(companyId);
  if (!c) throw new ValidationError("Connect your provider account first.");
  try {
    await call(c.provider, c.account, c.secret, null);
    await prisma.posCompany.update({ where: { companyId }, data: { fiscalTestedAt: new Date(), fiscalTestOk: true } });
    return { ok: true as const };
  } catch (e) {
    await prisma.posCompany.update({ where: { companyId }, data: { fiscalTestedAt: new Date(), fiscalTestOk: false } });
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

async function receiptOf(saleId: string): Promise<FiscalReceipt> {
  const s = await prisma.posSale.findUniqueOrThrow({
    where: { id: saleId },
    include: { lines: true, payments: true, refundOf: { select: { fiscalNumber: true, number: true } } },
  });
  const co = await prisma.company.findUniqueOrThrow({ where: { id: s.companyId }, select: { legalName: true, taxId: true, country: { select: { code: true } } } });
  return {
    number: s.number, kind: s.kind, soldAt: s.soldAt.toISOString(), currency: s.currency, gross: s.gross.toFixed(2), net: s.net.toFixed(2), vat: s.vat.toFixed(2),
    refundOf: s.refundOf ? (s.refundOf.fiscalNumber ?? s.refundOf.number) : null, customerTaxId: s.customerTaxId,
    lines: s.lines.map((l) => ({ name: l.name, qty: l.qty.toString(), unitPrice: l.unitPrice.toString(), vatRate: l.vatRate.toString(), gross: l.gross.toFixed(2) })),
    payments: s.payments.map((p) => ({ method: p.method, amount: p.amount.toFixed(2) })),
    business: { name: co.legalName, taxId: co.taxId, country: co.country.code },
  };
}

const BACKOFF_MIN = [1, 5, 15, 30, 60, 120, 240, 480];

/** Send one receipt to the business's provider; on failure it waits for the next try (or fails after 8). */
export async function fiscalize(saleId: string) {
  const s = await prisma.posSale.findUnique({ where: { id: saleId }, select: { id: true, companyId: true, fiscalStatus: true, fiscalAttempts: true, number: true } });
  if (!s || s.fiscalStatus === "DONE" || s.fiscalStatus === "NOT_REQUIRED") return s?.fiscalStatus ?? null;
  const c = await connection(s.companyId);
  const attempts = s.fiscalAttempts + 1;
  try {
    if (!c) throw new Error("The business's provider account isn't connected.");
    const r = await call(c.provider, c.account, c.secret, await receiptOf(s.id));
    await prisma.posSale.update({ where: { id: s.id }, data: { fiscalStatus: "DONE", fiscalProvider: c.provider, fiscalNumber: r.number, fiscalRef: r.ref, fiscalQr: r.qr, fiscalAttempts: attempts, fiscalError: null, fiscalNextAt: null } });
    return "DONE" as const;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    const failed = attempts >= BACKOFF_MIN.length || !(e instanceof FiscalTransient) && !msg.includes("isn't available yet") && !msg.includes("isn't connected");
    await prisma.posSale.update({
      where: { id: s.id },
      data: { fiscalStatus: failed ? "FAILED" : "PENDING", fiscalAttempts: attempts, fiscalError: msg, fiscalNextAt: failed ? null : new Date(Date.now() + BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000) },
    });
    if (failed) {
      const { notify } = await import("@/server/notify/dispatch");
      await notify("pos.fiscal_failed", [{ companyId: s.companyId }], { number: s.number, error: msg }, { ref: { type: "PosSale", id: s.id } }).catch(() => null);
    }
    return failed ? ("FAILED" as const) : ("PENDING" as const);
  }
}

/** The cron (every 5 minutes) and the kick after a sale. */
export async function processPosFiscalQueue(limit = 100, now = new Date()) {
  const due = await prisma.posSale.findMany({ where: { fiscalStatus: "PENDING", OR: [{ fiscalNextAt: null }, { fiscalNextAt: { lte: now } }] }, orderBy: { createdAt: "asc" }, take: limit, select: { id: true } });
  const out = { done: 0, pending: 0, failed: 0 };
  for (const d of due) {
    const r = await fiscalize(d.id);
    if (r === "DONE") out.done++; else if (r === "FAILED") out.failed++; else out.pending++;
  }
  return out;
}

export function kickPosQueue() {
  if (process.env.NODE_ENV === "test") return; // tests run the queue themselves
  setTimeout(() => void processPosFiscalQueue(25).catch((e) => console.error("[pos] fiscal queue", e)), 50);
}

/** Send a failed / waiting receipt again (the business, or FIRINGI finance). */
export async function retryFiscal(ctx: Ctx, saleId: string) {
  const s = await prisma.posSale.findUnique({ where: { id: saleId }, select: { companyId: true, fiscalStatus: true } });
  if (!s) throw new NotFoundError();
  const admin = ctx.company.type === "ADMIN" && can(ctx, ["admin.settings.manage", "admin.finance.manage"]);
  if (!admin && !(ctx.company.id === s.companyId && can(ctx, "company.pos.manage"))) throw new ForbiddenError();
  if (s.fiscalStatus !== "FAILED" && s.fiscalStatus !== "PENDING") throw new ValidationError("This receipt doesn't need sending.");
  await prisma.posSale.update({ where: { id: saleId }, data: { fiscalStatus: "PENDING", fiscalAttempts: 0, fiscalNextAt: null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pos.fiscal.retry", entityType: "PosSale", entityId: saleId });
  return fiscalize(saleId);
}
