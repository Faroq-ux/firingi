/**
 * Certified invoicing through Moloni.
 *
 * FIRINGI books every invoice / credit note in its own ledger at once (its own reference,
 * totals, balances) — inside the delivery or credit transaction. With Moloni switched on the
 * document is then PENDING: a queue issues it at Moloni (status closed = communicated to AT by
 * Moloni), stores Moloni's legal number, hash and line ids, and serves Moloni's PDF. If Moloni
 * is down the queue retries with back-off; a refused document goes to FAILED for finance.
 * Credit notes wait until their invoice is at Moloni (they must point at its lines).
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { MoloniError, moloniCall, moloniForgetful, moloniMode } from "./moloni/client";

export const FISCAL_KEY = "invoicing.provider";
export type MoloniSettings = {
  companyId: number | null; invoiceSetId: number | null; creditNoteSetId: number | null; maturityDateId: number | null; paymentMethodId: number | null;
  categoryId: number | null; unitId: number | null; exemptionReason: string; taxMap: Record<string, number>;
};
export type FiscalSettings = { provider: "internal" | "moloni"; moloni: MoloniSettings };
export const DEFAULT_FISCAL: FiscalSettings = {
  provider: "internal",
  moloni: { companyId: null, invoiceSetId: null, creditNoteSetId: null, maturityDateId: null, paymentMethodId: null, categoryId: null, unitId: null, exemptionReason: "M99", taxMap: {} },
};
const MAX_ATTEMPTS = 8;
const BACKOFF_MIN = [1, 5, 15, 30, 60, 120, 240, 480];
const DELIVERY_REF = "FIRINGI-ENTREGA";

type Db = Prisma.TransactionClient | typeof prisma;
export async function fiscalSettings(db: Db = prisma): Promise<FiscalSettings> {
  const row = await db.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: FISCAL_KEY } });
  const v = (row?.value ?? {}) as Partial<FiscalSettings>;
  return { provider: v.provider ?? "internal", moloni: { ...DEFAULT_FISCAL.moloni, ...(v.moloni ?? {}) } };
}

/** The issuing transaction asks this: book locally only, or queue for Moloni. */
export async function usesMoloni(db: Db) {
  return (await fiscalSettings(db)).provider === "moloni";
}

function assertFinance(ctx: Ctx, manage = false) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, manage ? ["admin.settings.manage", "admin.tax.manage"] : ["admin.finance.view", "admin.tax.manage", "admin.settings.manage", "admin.invoices.view"])) throw new ForbiddenError();
}

const missing = (m: MoloniSettings) =>
  (["companyId", "invoiceSetId", "creditNoteSetId", "maturityDateId", "paymentMethodId", "categoryId", "unitId"] as const).filter((k) => !m[k]);

export async function saveFiscalSettings(ctx: Ctx, input: FiscalSettings) {
  assertFinance(ctx, true);
  const cur = await fiscalSettings();
  const next: FiscalSettings = { provider: input.provider, moloni: { ...cur.moloni, ...input.moloni } };
  if (next.provider === "moloni") {
    if (moloniMode() === "off") throw new ValidationError("Moloni is not connected on the server yet (MOLONI_* keys).");
    const gaps = missing(next.moloni);
    if (gaps.length) throw new ValidationError(`Choose these Moloni settings first: ${gaps.join(", ")}.`);
    if (!Object.keys(next.moloni.taxMap).length) throw new ValidationError("Map FIRINGI's VAT rates to Moloni taxes first.");
  }
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: FISCAL_KEY } },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
    create: { scope: "GLOBAL", key: FISCAL_KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "invoicing.provider", entityType: "Setting", entityId: FISCAL_KEY, before: cur, after: next });
  return next;
}

// ── connection test + options for the settings page ────────────────────────

type Opt = { id: number; name: string };
export async function moloniOptions(ctx: Ctx, companyId?: number | null) {
  assertFinance(ctx);
  const mode = moloniMode();
  if (mode === "off") return { mode, ok: false as const, error: "Not connected: set MOLONI_CLIENT_ID, MOLONI_CLIENT_SECRET, MOLONI_USERNAME and MOLONI_PASSWORD on the server.", companies: [] as Opt[] };
  try {
    const companies = (await moloniCall<{ company_id: number; name: string; vat: string }[]>("companies/getAll")).map((c) => ({ id: c.company_id, name: `${c.name} (${c.vat})` }));
    const cid = companyId ?? (await fiscalSettings()).moloni.companyId ?? companies[0]?.id ?? null;
    if (!cid) return { mode, ok: true as const, companies };
    const q = { company_id: cid };
    const [sets, taxes, maturity, methods, units, categories, exemptions] = await Promise.all([
      moloniCall<{ document_set_id: number; name: string; active_by_default: number }[]>("documentSets/getAll", q),
      moloniCall<{ tax_id: number; name: string; value: number; saft_type: number; fiscal_zone: string }[]>("taxes/getAll", q),
      moloniCall<{ maturity_date_id: number; name: string; days: number }[]>("maturityDates/getAll", q),
      moloniCall<{ payment_method_id: number; name: string }[]>("paymentMethods/getAll", q),
      moloniCall<{ unit_id: number; name: string }[]>("measurementUnits/getAll", q),
      moloniCall<{ category_id: number; name: string }[]>("productCategories/getAll", { ...q, parent_id: 0 }),
      moloniCall<{ code: string; name: string }[]>("taxExemptions/getAll", {}),
    ]);
    const vat = taxes.filter((t) => Number(t.saft_type) === 1);
    return {
      mode, ok: true as const, companyId: cid, companies,
      sets: sets.map((s) => ({ id: s.document_set_id, name: `${s.name}${s.active_by_default ? " (default)" : ""}` })),
      taxes: vat.map((t) => ({ id: t.tax_id, name: `${t.name} — ${t.value}% (${t.fiscal_zone})`, value: Number(t.value), zone: t.fiscal_zone })),
      maturity: maturity.map((m) => ({ id: m.maturity_date_id, name: `${m.name} (${m.days} d)` })),
      methods: methods.map((m) => ({ id: m.payment_method_id, name: m.name })),
      units: units.map((u) => ({ id: u.unit_id, name: u.name })),
      categories: categories.map((c) => ({ id: c.category_id, name: c.name })),
      exemptions: exemptions.map((e) => ({ code: e.code, name: `${e.code} — ${e.name}` })),
      /** Suggested rate → tax mapping: each FIRINGI VAT rate to the Moloni VAT tax with that value. */
      suggestedTaxMap: Object.fromEntries((await prisma.taxRate.findMany({ where: { country: { code: "PT" } }, select: { rate: true }, distinct: ["rate"] }))
        .map((r) => Number(r.rate)).filter((r) => r > 0)
        .map((r) => [r.toFixed(3), (vat.find((t) => Number(t.value) === r && t.fiscal_zone === "PT") ?? vat.find((t) => Number(t.value) === r))?.tax_id])
        .filter(([, id]) => id)) as Record<string, number>,
    };
  } catch (e) {
    return { mode, ok: false as const, error: e instanceof Error ? e.message : String(e), companies: [] as Opt[] };
  }
}

/** FIRINGI's Portuguese VAT rates (> 0), to map to Moloni taxes on the settings page. */
export async function vatRatesToMap(ctx: Ctx) {
  assertFinance(ctx);
  const rows = await prisma.taxRate.findMany({ where: { country: { code: "PT" }, rate: { gt: 0 } }, select: { rate: true }, distinct: ["rate"], orderBy: { rate: "desc" } });
  return rows.map((r) => Number(r.rate).toFixed(3));
}

// ── mapping FIRINGI → Moloni ────────────────────────────────────────────────

// Ids are remembered per Moloni account kind (live / sandbox); the simulated Moloni forgets its
// data when the server restarts, so there FIRINGI always looks them up.
const mapKey = () => (moloniMode() === "sandbox" ? "moloni-sandbox" : moloniMode() === "simulated" ? "moloni-test" : "moloni");
async function mapped(kind: "CUSTOMER" | "PRODUCT", localId: string) {
  if (moloniForgetful()) return null;
  return (await prisma.providerEntityMap.findUnique({ where: { provider_kind_localId: { provider: mapKey(), kind, localId } } }))?.remoteId ?? null;
}
async function remember(kind: "CUSTOMER" | "PRODUCT", localId: string, remoteId: number) {
  if (moloniForgetful()) return;
  await prisma.providerEntityMap.upsert({ where: { provider_kind_localId: { provider: mapKey(), kind, localId } }, update: { remoteId: String(remoteId) }, create: { provider: mapKey(), kind, localId, remoteId: String(remoteId) } });
}
const list = <T,>(x: T | T[] | null | undefined): T[] => (Array.isArray(x) ? x : x ? [x] : []);

let countryCache: { at: number; rows: { country_id: number; iso_3166_1: string; languages?: { language_id: number }[] }[] } | null = null;
async function moloniCountry(code: string) {
  if (!countryCache || Date.now() - countryCache.at > 86400_000) countryCache = { at: Date.now(), rows: await moloniCall("countries/getAll") };
  const c = countryCache.rows.find((r) => r.iso_3166_1?.toUpperCase() === code.toUpperCase());
  if (!c) throw new MoloniError(`Moloni has no country ${code}.`, "VALIDATION");
  return { countryId: c.country_id, languageId: c.languages?.[0]?.language_id ?? 1 };
}

async function customerId(m: MoloniSettings, companyId: string) {
  const known = await mapped("CUSTOMER", companyId);
  if (known) return Number(known);
  const co = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: { country: { select: { code: true } } } });
  const found = list(await moloniCall<{ customer_id: number }[]>("customers/getByVat", { company_id: m.companyId, vat: co.taxId }))[0];
  if (found) { await remember("CUSTOMER", companyId, found.customer_id); return found.customer_id; }
  const addr = (await prisma.address.findFirst({ where: { companyId, isActive: true, kind: "BILLING" }, orderBy: { isDefault: "desc" } }))
    ?? (await prisma.address.findFirst({ where: { companyId, isActive: true, kind: "HEAD_OFFICE" } }))
    ?? (await prisma.address.findFirst({ where: { companyId, isActive: true } }));
  const { countryId, languageId } = await moloniCountry(co.country.code);
  const res = await moloniCall<{ customer_id: number }>("customers/insert", {
    company_id: m.companyId, vat: co.taxId, number: co.taxId.slice(0, 20), name: co.legalName, language_id: languageId,
    address: addr ? [addr.line1, addr.line2].filter(Boolean).join(", ") : "—", zip_code: addr?.postalCode ?? "", city: addr?.cityName ?? "—", country_id: countryId,
    email: co.email, maturity_date_id: m.maturityDateId, payment_method_id: m.paymentMethodId, copies: [], notes: "Created by FIRINGI",
  });
  await remember("CUSTOMER", companyId, res.customer_id);
  return res.customer_id;
}

async function productId(m: MoloniSettings, ref: string, name: string, price: number, taxes: { tax_id: number }[], exemption: string | null, service: boolean) {
  const known = await mapped("PRODUCT", ref);
  if (known) return Number(known);
  const found = list(await moloniCall<{ product_id: number; reference: string }[]>("products/getByReference", { company_id: m.companyId, reference: ref, exact: 1 })).find((p) => p.reference === ref);
  if (found) { await remember("PRODUCT", ref, found.product_id); return found.product_id; }
  const res = await moloniCall<{ product_id: number }>("products/insert", {
    company_id: m.companyId, category_id: m.categoryId, type: service ? 2 : 1, name, reference: ref, price, unit_id: m.unitId, has_stock: 0, stock: 0,
    ...(taxes.length ? { taxes: taxes.map((t, i) => ({ tax_id: t.tax_id, value: 0, order: i + 1, cumulative: 0 })) } : { exemption_reason: exemption ?? m.exemptionReason }),
  });
  await remember("PRODUCT", ref, res.product_id);
  return res.product_id;
}

// ── issuing ─────────────────────────────────────────────────────────────────

const day = (d: Date) => d.toISOString().slice(0, 10);

async function issueAtMoloni(invoiceId: string): Promise<"DONE" | "WAIT"> {
  const s = await fiscalSettings();
  const m = s.moloni;
  if (missing(m).length) throw new MoloniError("Moloni settings are incomplete.", "CONFIG");
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { lines: { orderBy: { position: "asc" }, include: { orderLine: { select: { sku: true } }, exemptionReason: { select: { code: true } } } }, originalInvoice: { include: { lines: { orderBy: { position: "asc" } } } }, order: { select: { number: true, poReference: true, costCentre: true, branch: { select: { name: true } } } } },
  });
  const credit = inv.docType === "CREDIT_NOTE";
  if (credit && inv.originalInvoice?.fiscalStatus !== "DONE") return "WAIT"; // the invoice must be at Moloni first
  const customer = await customerId(m, inv.recipientCompanyId);
  const origData = (inv.originalInvoice?.providerData ?? null) as { documentId: number; lineIds: number[] } | null;
  const products = [];
  for (const l of inv.lines) {
    const rate = Number(l.taxRate);
    const taxId = m.taxMap[rate.toFixed(3)];
    if (rate > 0 && !taxId) throw new MoloniError(`No Moloni tax mapped for ${rate}% VAT.`, "CONFIG");
    const taxes = rate > 0 ? [{ tax_id: taxId }] : [];
    const exemption = rate > 0 ? null : l.exemptionReason?.code ?? m.exemptionReason;
    const ref = l.orderLine?.sku ?? DELIVERY_REF;
    const qty = Number(l.qty), unit = Number(l.unitPriceNet), gross = qty * unit;
    // Moloni discounts are a percentage of the line; derived from FIRINGI's frozen amounts.
    const discount = gross > 0 ? new Decimal(l.discountNet.toString()).div(gross).mul(100).toDecimalPlaces(6).toNumber() : 0;
    const pid = await productId(m, ref, l.description.slice(0, 200), unit, taxes, exemption, !l.orderLine);
    const line: Record<string, unknown> = { product_id: pid, name: l.description.slice(0, 200), qty, price: unit, discount, order: l.position, ...(taxes.length ? { taxes: taxes.map((t, i) => ({ ...t, order: i + 1, cumulative: 0 })) } : { exemption_reason: exemption }) };
    if (credit) {
      // The credit note line points at the same line of the invoice at Moloni.
      const origLine = inv.originalInvoice!.lines.find((o) => (l.orderLineId ? o.orderLineId === l.orderLineId : o.description === l.description));
      const related = origLine && origData?.lineIds[origLine.position - 1];
      if (!related) throw new MoloniError(`Can't find invoice line "${l.description}" at Moloni.`, "VALIDATION");
      line.related_id = related;
    }
    products.push(line);
  }
  const common = {
    company_id: m.companyId, date: day(inv.issuedAt ?? new Date()), customer_id: customer, our_reference: inv.fullNumber ?? "", your_reference: inv.order?.number ?? "",
    notes: [credit ? `Nota de crédito FIRINGI ${inv.fullNumber}${(inv.recipientSnapshot as { reason?: string }).reason ? ` — ${(inv.recipientSnapshot as { reason?: string }).reason}` : ""}` : `Fatura FIRINGI ${inv.fullNumber}`,
      // Phase 27: the customer's references
      inv.order?.poReference ? `PO: ${inv.order.poReference}` : null, inv.order?.branch ? `Loja: ${inv.order.branch.name}` : null, inv.order?.costCentre ? `Centro de custo: ${inv.order.costCentre}` : null].filter(Boolean).join(" · "),
    products, status: 1,
  };
  // Never issue twice: if an earlier attempt reached Moloni but FIRINGI didn't hear back, reuse it.
  const earlier = list(await moloniCall<{ document_id: number; our_reference: string }[]>(credit ? "creditNotes/getAll" : "invoices/getAll", { company_id: m.companyId, our_reference: inv.fullNumber ?? "", qty: 5 }))
    .find((d) => d.our_reference === inv.fullNumber);
  const ins = earlier ? { document_id: earlier.document_id }
    : credit
      ? await moloniCall<{ document_id: number }>("creditNotes/insert", { ...common, document_set_id: m.creditNoteSetId, associated_documents: [{ associated_id: origData!.documentId, value: Number(inv.grossTotal) }] })
      : await moloniCall<{ document_id: number }>("invoices/insert", { ...common, document_set_id: m.invoiceSetId, expiration_date: day(inv.dueAt ?? inv.issuedAt ?? new Date()) });
  const doc = await moloniCall<{ number: number; rsa_hash: string; gross_value: number; net_value: number; taxes_value: number; document_set?: { name: string }; document_type?: { saft_code: string }; products: { document_product_id?: number }[] }>(
    credit ? "creditNotes/getOne" : "invoices/getOne", { company_id: m.companyId, document_id: ins.document_id });
  const providerNumber = `${doc.document_type?.saft_code ?? (credit ? "NC" : "FT")} ${doc.document_set?.name ?? m.invoiceSetId}/${doc.number}`;
  const diff = Math.abs(Number(doc.gross_value) - Number(inv.grossTotal));
  const mode = moloniMode();
  await prisma.invoice.update({
    where: { id: inv.id },
    data: {
      fiscalStatus: "DONE", providerNumber: mode === "simulated" ? `SIM ${providerNumber}` : providerNumber, externalId: String(ins.document_id),
      externalProvider: mode === "simulated" ? "moloni-simulated" : `moloni${mode === "sandbox" ? "-sandbox" : ""}`, hash: inv.hash ?? doc.rsa_hash ?? null,
      fiscalError: diff > 0.01 ? `Moloni total ${Number(doc.gross_value).toFixed(2)} € differs from FIRINGI's ${Number(inv.grossTotal).toFixed(2)} € (rounding) — check the document.` : null,
      providerData: { documentId: ins.document_id, number: doc.number, lineIds: list(doc.products).map((p) => p.document_product_id ?? null), totals: { net: doc.net_value, vat: doc.taxes_value, gross: doc.gross_value }, mismatch: diff > 0.01 } as Prisma.InputJsonValue,
    },
  });
  return "DONE";
}

/** Try one pending document now. Errors are recorded on the document, never thrown. */
export async function fiscalize(invoiceId: string) {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { fiscalStatus: true, fiscalAttempts: true, fullNumber: true } });
  if (!inv || (inv.fiscalStatus !== "PENDING" && inv.fiscalStatus !== "FAILED")) return inv?.fiscalStatus ?? null;
  // Claim it for 2 minutes so the cron and an after-delivery kick never send the same document twice.
  const now = new Date();
  const claimed = await prisma.invoice.updateMany({
    where: { id: invoiceId, fiscalStatus: { in: ["PENDING", "FAILED"] }, OR: [{ fiscalNextAt: null }, { fiscalNextAt: { lte: now } }] },
    data: { fiscalNextAt: new Date(now.getTime() + 2 * 60_000) },
  });
  if (!claimed.count) return "PENDING"; // someone else is on it, or it isn't due yet
  try {
    const r = await issueAtMoloni(invoiceId);
    if (r === "WAIT") { await prisma.invoice.update({ where: { id: invoiceId }, data: { fiscalNextAt: new Date(Date.now() + 2 * 60_000) } }); return "PENDING"; }
    return "DONE";
  } catch (e) {
    const err = e instanceof MoloniError ? e : new MoloniError(e instanceof Error ? e.message : String(e), "UNAVAILABLE");
    const attempts = inv.fiscalAttempts + 1;
    const giveUp = !err.retryable || attempts >= MAX_ATTEMPTS;
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { fiscalAttempts: attempts, fiscalError: err.message.slice(0, 500), fiscalStatus: giveUp ? "FAILED" : "PENDING", fiscalNextAt: giveUp ? null : new Date(Date.now() + BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000) },
    });
    if (giveUp && inv.fiscalStatus !== "FAILED") {
      const { notify } = await import("@/server/notify/dispatch");
      const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
      if (admin) await notify("invoicing.failed", [{ companyId: admin.id, link: "/admin/finance/invoicing" }], { number: inv.fullNumber ?? "", reason: err.message.slice(0, 200) }, { ref: { type: "Invoice", id: invoiceId } });
    }
    return giveUp ? "FAILED" : "PENDING";
  }
}

/** The queue: due PENDING documents, invoices before credit notes, oldest first. */
export async function processFiscalQueue(limit = 25) {
  if (moloniMode() === "off") return { done: 0, pending: 0, failed: 0, skipped: "Moloni not connected" };
  const due = await prisma.invoice.findMany({
    where: { fiscalStatus: "PENDING", OR: [{ fiscalNextAt: null }, { fiscalNextAt: { lte: new Date() } }] },
    orderBy: [{ docType: "asc" }, { issuedAt: "asc" }], take: limit, select: { id: true },
  });
  const out = { done: 0, pending: 0, failed: 0 };
  for (const d of due) {
    const r = await fiscalize(d.id);
    if (r === "DONE") out.done++; else if (r === "FAILED") out.failed++; else out.pending++;
  }
  return out;
}

/** After a transaction that booked documents: try them now (best effort; the cron retries). */
export function kickFiscalQueue() {
  void processFiscalQueue().catch(() => {}).finally(async () => {
    // Phase 46: then the e-invoices queued by the same transaction
    (await import("@/server/einvoice/service")).kickEInvoiceQueue();
  });
}

/** Finance retries a failed document after fixing the cause (e.g. settings or customer data). */
export async function retryFiscal(ctx: Ctx, invoiceId: string) {
  assertFinance(ctx, true);
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) throw new NotFoundError("Invoice");
  if (inv.fiscalStatus !== "FAILED" && inv.fiscalStatus !== "PENDING") throw new ValidationError("This document doesn't need sending to Moloni.");
  await prisma.invoice.update({ where: { id: invoiceId }, data: { fiscalStatus: "PENDING", fiscalNextAt: null, fiscalAttempts: 0 } });
  const r = await fiscalize(invoiceId);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "invoicing.retry", entityType: "Invoice", entityId: invoiceId, after: { result: r } });
  return r;
}

export async function fiscalOverview(ctx: Ctx) {
  assertFinance(ctx);
  const [counts, problems, recent] = await Promise.all([
    prisma.invoice.groupBy({ by: ["fiscalStatus"], where: { status: { not: "DRAFT" } }, _count: { _all: true } }),
    prisma.invoice.findMany({ where: { OR: [{ fiscalStatus: { in: ["FAILED", "PENDING"] } }, { fiscalStatus: "DONE", fiscalError: { not: null } }] }, orderBy: { issuedAt: "asc" }, take: 100, include: { recipient: { select: { legalName: true } } } }),
    prisma.invoice.findMany({ where: { fiscalStatus: "DONE" }, orderBy: { issuedAt: "desc" }, take: 10, include: { recipient: { select: { legalName: true } } } }),
  ]);
  return { counts: Object.fromEntries(counts.map((c) => [c.fiscalStatus, c._count._all])) as Partial<Record<"LOCAL" | "PENDING" | "DONE" | "FAILED", number>>, problems, recent, mode: moloniMode(), settings: await fiscalSettings() };
}

/** Moloni's own (signed) PDF for a document issued there; null when FIRINGI renders it. */
export async function providerPdf(inv: { externalProvider: string | null; externalId: string | null; fiscalStatus: string }): Promise<Uint8Array | null> {
  if (inv.fiscalStatus !== "DONE" || !inv.externalId || !inv.externalProvider?.startsWith("moloni") || inv.externalProvider === "moloni-simulated") return null;
  const m = (await fiscalSettings()).moloni;
  const { url } = await moloniCall<{ url: string }>("documents/getPDFLink", { company_id: m.companyId, document_id: Number(inv.externalId), signed: 1 });
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new MoloniError(`Moloni's PDF couldn't be downloaded (HTTP ${res.status}).`, "UNAVAILABLE");
  return new Uint8Array(await res.arrayBuffer());
}
