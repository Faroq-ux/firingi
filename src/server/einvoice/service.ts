/**
 * Phase 46 — e-invoicing.
 *
 * When FIRINGI issues a document (inside the issuing transaction) it decides the document's language(s) and,
 * from the recipient's country route, whether and how the document goes out electronically: an EInvoiceDocument
 * is queued. The queue (after the transaction, and the cron) builds the XML, checks it, archives it with its hash
 * and sends it through the chosen service; it then follows the status (delivered / cleared / accepted / rejected),
 * retries outages with back-off and alerts finance on failures. Supplier e-invoices arrive the same way and are
 * matched to their billing statements; suppliers with a self-billing agreement get their invoices issued by FIRINGI.
 */
import "server-only";
import { createHash } from "node:crypto";
import type { EInvoiceKind, EInvoiceStatus, Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { zipSync, strToU8 } from "fflate";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { putObject, readStored } from "@/server/services/storage";
import {
  DEFAULT_EINVOICE_SETTINGS, ISSUER_BOUND, PEPPOL_ID, PROVIDER_INFO, documentLanguages, isDocLanguage, mergeEInvoiceSettings, providerFits,
  type EFormat, type EInvoiceSettings, type EProvider,
} from "@/lib/einvoice";
import { renderXml, xmlFileName } from "./formats";
import { invoiceEDoc, statementEDoc, vatWithPrefix } from "./model";
import { parseEInvoice, type ParsedInvoice } from "./parse";
import { adapter, EInvoiceError, providerMode, simulating } from "./providers";
import { hasErrors, validateEDoc, type Finding } from "./validate";
import type { EDoc } from "./types";

export const EINV_KEY = "einvoice.settings";
type Db = Tx | typeof prisma;

const MAX_ATTEMPTS = 8;
const BACKOFF_MIN = [1, 5, 15, 30, 60, 120, 240, 480];

// ── settings ────────────────────────────────────────────────────────────────

export async function einvoiceSettings(db: Db = prisma): Promise<EInvoiceSettings> {
  const row = await db.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: EINV_KEY } });
  return mergeEInvoiceSettings(row?.value ?? DEFAULT_EINVOICE_SETTINGS);
}

const isStaff = (ctx: Ctx) => ctx.company.type === "ADMIN";
function assertAdmin(ctx: Ctx, manage = false) {
  if (!isStaff(ctx) || !can(ctx, manage ? ["admin.settings.manage", "admin.tax.manage"] : ["admin.finance.view", "admin.invoices.view", "admin.tax.manage", "admin.settings.manage"])) throw new ForbiddenError();
}

export async function saveEInvoiceSettings(ctx: Ctx, input: unknown) {
  assertAdmin(ctx, true);
  const before = await einvoiceSettings();
  const next = mergeEInvoiceSettings(input);
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: EINV_KEY } },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
    create: { scope: "GLOBAL", key: EINV_KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "einvoice.settings", entityType: "Setting", entityId: EINV_KEY, before, after: next });
  return next;
}

// ── language of a document ──────────────────────────────────────────────────

/** The language(s) FIRINGI prints a document to this company in (fixed on the document when issued). */
export async function languagesFor(db: Db, recipientCompanyId: string, legalEntityId: string) {
  const s = await einvoiceSettings(db);
  const co = await db.company.findUniqueOrThrow({ where: { id: recipientCompanyId }, select: { country: { select: { defaultLanguageCode: true } }, einvoiceProfile: true } });
  const le = await db.legalEntity.findUniqueOrThrow({ where: { id: legalEntityId }, select: { language: true, secondLanguage: true, requireOwnLanguage: true, country: { select: { defaultLanguageCode: true } } } });
  return documentLanguages(s, {
    customerCountryLanguage: co.country.defaultLanguageCode, customerChoice: co.einvoiceProfile?.invoiceLanguage ?? null, customerSecond: co.einvoiceProfile?.secondLanguage ?? null,
    entityLanguage: le.language ?? le.country.defaultLanguageCode, entitySecond: le.secondLanguage, requireOwnLanguage: le.requireOwnLanguage,
  });
}

// ── which documents go out, and how ─────────────────────────────────────────

export type Plan = { format: EFormat; provider: EProvider; channel: string; countryCode: string; emailCopy: boolean; mandatory: boolean };

/**
 * The route for a document to a company: its country's route when switched on and either mandatory (KSeF, SDI,
 * Verifactu …) or asked for by the company (a Peppol id, or e-invoices chosen). A format bound to one country's tax
 * system is only used for FIRINGI's company there; otherwise a Peppol id falls back to Peppol.
 */
export async function planFor(db: Db, x: { kind: EInvoiceKind; recipientCompanyId: string; issuerCountry: string }): Promise<Plan | null> {
  const s = await einvoiceSettings(db);
  if (!s.enabled) return null;
  const docOn = { INVOICE: s.documents.customerInvoices, CREDIT_NOTE: s.documents.creditNotes, SERVICE_INVOICE: s.documents.serviceInvoices, SELF_BILLED: s.documents.selfBilling, SELF_BILLED_CREDIT: s.documents.selfBilling, SUPPLIER_INVOICE: s.documents.receiveSupplier }[x.kind];
  if (!docOn) return null;
  const co = await db.company.findUniqueOrThrow({ where: { id: x.recipientCompanyId }, select: { country: { select: { code: true } }, einvoiceProfile: true } });
  const cc = co.country.code;
  const route = s.countries[cc];
  if (!route?.enabled) return null;
  const p = co.einvoiceProfile;
  const wants = !!p && p.delivery !== "EMAIL" && (!!p.peppolId || p.delivery === "EINVOICE");
  let format = route.format;
  let provider = route.provider;
  let mandatory = route.mandatory;
  const bound = ISSUER_BOUND[format];
  if (bound && bound !== x.issuerCountry) {
    if (!p?.peppolId || p.delivery === "EMAIL") return null;
    format = "PEPPOL_BIS3";
    provider = providerFits(provider, "PEPPOL_BIS3", cc) ? provider : "peppol-ap";
    mandatory = false;
  } else if (!mandatory && !wants) return null;
  return { format, provider, channel: PROVIDER_INFO[provider].channel, countryCode: cc, emailCopy: route.emailCopy, mandatory };
}

const retentionUntil = (s: EInvoiceSettings, cc: string, from = new Date()) => {
  const d = new Date(from);
  d.setUTCFullYear(d.getUTCFullYear() + (s.retention[cc] ?? 10));
  return d;
};

async function event(db: Db, documentId: string, status: EInvoiceStatus, message: string, data?: Prisma.InputJsonValue, actorUserId?: string | null) {
  await db.eInvoiceEvent.create({ data: { documentId, status, message: message.slice(0, 1000), ...(data ? { data } : {}), actorUserId: actorUserId ?? null } });
}

/** Inside the issuing transaction: queue the invoice / credit note when its recipient's route says so. */
export async function queueForInvoice(tx: Tx, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { id: true, docType: true, orderId: true, fullNumber: true, recipientCompanyId: true, legalEntityId: true, language: true, recipient: { select: { type: true } }, legalEntity: { select: { country: { select: { code: true } } } } },
  });
  const kind: EInvoiceKind = inv.docType === "CREDIT_NOTE" ? "CREDIT_NOTE" : !inv.orderId ? "SERVICE_INVOICE" : "INVOICE";
  const plan = await planFor(tx, { kind, recipientCompanyId: inv.recipientCompanyId, issuerCountry: inv.legalEntity.country.code });
  if (!plan) return null;
  const s = await einvoiceSettings(tx);
  const doc = await tx.eInvoiceDocument.create({
    data: {
      direction: "OUTBOUND", kind, status: "QUEUED", invoiceId: inv.id, counterpartyId: inv.recipientCompanyId, legalEntityId: inv.legalEntityId, countryCode: plan.countryCode,
      format: plan.format, channel: plan.channel, provider: plan.provider, number: inv.fullNumber ?? inv.id, language: inv.language, archiveUntil: retentionUntil(s, plan.countryCode),
    },
  });
  await event(tx, doc.id, "QUEUED", `Queued for ${PROVIDER_INFO[plan.provider].label} as ${plan.format}${plan.mandatory ? " (mandatory in this country)" : ""}.`);
  return doc;
}

// ── self-billing ────────────────────────────────────────────────────────────

/**
 * Inside the delivery / credit transaction: a supplier with a self-billing agreement gets its invoice (or credit
 * note) issued by FIRINGI from the statement — numbered in its own self-billing series, recorded and matched at once
 * (no upload), and sent to it electronically when its route says so.
 */
export async function selfBillStatement(tx: Tx, statementId: string, actorUserId: string | null) {
  const s = await einvoiceSettings(tx);
  if (!s.enabled || !s.documents.selfBilling) return null;
  const st = await tx.vendorBillingStatement.findUniqueOrThrow({ where: { id: statementId }, include: { vendor: { select: { taxId: true, country: { select: { code: true } }, einvoiceProfile: true } } } });
  if (!st.vendor.einvoiceProfile?.selfBilling || st.selfBilledNumber || st.status !== "OPEN") return null;
  const year = new Date().getFullYear();
  const seq = await tx.$queryRaw<{ n: number }[]>`INSERT INTO "Sequence" (name, year, "nextValue") VALUES (${`selfbill:${st.vendorCompanyId}`}, ${year}, 2)
    ON CONFLICT (name, year) DO UPDATE SET "nextValue" = "Sequence"."nextValue" + 1 RETURNING "nextValue" - 1 AS n`;
  const number = `${st.isCreditStatement ? "AFNC" : "AF"} ${st.vendor.taxId.replace(/\W+/g, "")} ${year}/${seq[0].n}`;
  await tx.vendorBillingStatement.update({ where: { id: st.id }, data: { selfBilledNumber: number, selfBilledAt: new Date() } });
  const local = st.currencyCode !== "EUR" && st.expectedNetLocal != null;
  const { recordVendorInvoice } = await import("@/server/services/finance");
  const vi = await recordVendorInvoice({
    vendorCompanyId: st.vendorCompanyId, statementIds: [st.id], docType: st.isCreditStatement ? "CREDIT_NOTE" : "INVOICE", externalNumber: number, issueDate: new Date(),
    netTotal: (local ? st.expectedNetLocal! : st.expectedNet).toString(), vatTotal: (local ? st.expectedVatLocal! : st.expectedVat).toString(),
    fileKey: `selfbill/${st.id}.pdf`, source: "SELF_BILLED", structuredData: { selfBilled: true, agreement: st.vendor.einvoiceProfile.selfBillingAgreement ?? null }, actorUserId, actorCompanyId: null,
  }, tx);
  const kind: EInvoiceKind = st.isCreditStatement ? "SELF_BILLED_CREDIT" : "SELF_BILLED";
  const plan = await planFor(tx, { kind, recipientCompanyId: st.vendorCompanyId, issuerCountry: st.vendor.country.code });
  let doc = null;
  if (plan) {
    doc = await tx.eInvoiceDocument.create({
      data: {
        direction: "OUTBOUND", kind, status: "QUEUED", statementId: st.id, vendorInvoiceId: vi.id, counterpartyId: st.vendorCompanyId, countryCode: plan.countryCode,
        format: plan.format, channel: plan.channel, provider: plan.provider, number, archiveUntil: retentionUntil(s, plan.countryCode),
      },
    });
    await event(tx, doc.id, "QUEUED", `Self-billed ${st.isCreditStatement ? "credit note" : "invoice"} queued for ${PROVIDER_INFO[plan.provider].label} as ${plan.format}.`);
  }
  const { notify } = await import("@/server/notify/dispatch");
  await notify("einvoice.selfbilled", [{ companyId: st.vendorCompanyId, link: "/vendor/finance/invoices" }], { number, statement: st.number }, { ref: { type: "VendorBillingStatement", id: st.id } }).catch(() => null);
  return { number, vendorInvoiceId: vi.id, documentId: doc?.id ?? null };
}

// ── sending ─────────────────────────────────────────────────────────────────

async function edocFor(d: { invoiceId: string | null; statementId: string | null; legalEntityId: string | null; format: string }): Promise<EDoc> {
  const e = d.invoiceId ? (await invoiceEDoc(d.invoiceId)).doc : (await statementEDoc(d.statementId!)).doc;
  if (d.format === "VERIFACTU") {
    const prev = await prisma.eInvoiceDocument.findFirst({
      where: { direction: "OUTBOUND", format: "VERIFACTU", legalEntityId: d.legalEntityId, status: { in: ["SENT", "DELIVERED", "ACCEPTED"] } },
      orderBy: { sentAt: "desc" }, select: { number: true, parsed: true, sentAt: true },
    });
    const huella = (prev?.parsed as { huella?: string } | null)?.huella;
    if (prev && huella) e.extra = { ...e.extra, previousHash: huella, previousNumber: prev.number, previousDate: prev.sentAt?.toISOString().slice(0, 10) ?? null };
  }
  return e;
}

/** The PDF that goes with an e-invoice (Factur-X carries the XML inside it; e-mail copies attach it). */
async function pdfFor(d: { invoiceId: string | null; statementId: string | null }): Promise<Buffer | null> {
  try {
    if (d.invoiceId) {
      const { invoicePdfData } = await import("@/server/data/finance-docs");
      const { renderInvoicePdf } = await import("@/server/pdf/documents");
      return Buffer.from(await renderInvoicePdf(await invoicePdfData(null, d.invoiceId)));
    }
    const { selfBilledPdf } = await import("./pdf");
    return await selfBilledPdf(d.statementId!);
  } catch (e) {
    console.error("[einvoice] PDF", e);
    return null;
  }
}

/** Factur-X: the CII XML embedded in the PDF as "factur-x.xml" (PDF/A-3 attachment, EN 16931 profile). */
async function embedFacturX(pdf: Buffer, xml: string, number: string): Promise<Buffer> {
  const { PDFDocument, AFRelationship } = await import("pdf-lib");
  const doc = await PDFDocument.load(pdf);
  await doc.attach(Buffer.from(xml, "utf8"), "factur-x.xml", { mimeType: "text/xml", description: "Factur-X invoice (EN 16931)", afRelationship: AFRelationship.Data, creationDate: new Date(), modificationDate: new Date() });
  doc.setTitle(number);
  doc.setSubject("Factur-X EN 16931");
  doc.setProducer("FIRINGI");
  doc.setKeywords(["Factur-X", "ZUGFeRD", "EN16931"]);
  return Buffer.from(await doc.save({ useObjectStreams: false })); // plain objects: PDF/A-3 readers find the attachment
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function adminId() {
  return (await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } }))?.id ?? null;
}
async function alertFinance(event: "einvoice.failed" | "einvoice.rejected" | "einvoice.invalid" | "einvoice.received", docId: string, vars: Record<string, string>) {
  const id = await adminId();
  if (!id) return;
  const { notify } = await import("@/server/notify/dispatch");
  await notify(event, [{ companyId: id, link: `/admin/invoices/e-invoicing/${docId}` }], vars, { ref: { type: "EInvoiceDocument", id: docId } }).catch(() => null);
}

/** Try one queued document now. Never throws: the outcome is on the document. */
export async function processDocument(id: string): Promise<EInvoiceStatus | null> {
  const now = new Date();
  const claimed = await prisma.eInvoiceDocument.updateMany({ where: { id, status: "QUEUED", OR: [{ nextAt: null }, { nextAt: { lte: now } }] }, data: { nextAt: new Date(now.getTime() + 2 * 60_000) } });
  if (!claimed.count) return (await prisma.eInvoiceDocument.findUnique({ where: { id }, select: { status: true } }))?.status ?? null;
  const d = await prisma.eInvoiceDocument.findUniqueOrThrow({ where: { id }, include: { invoice: { select: { fiscalStatus: true, externalProvider: true, providerNumber: true, fullNumber: true } }, counterparty: { select: { legalName: true, email: true, einvoiceProfile: true } } } });
  // a document issued through the certified provider goes out with its legal number: wait for it
  if (d.invoice?.externalProvider === "moloni" && d.invoice.fiscalStatus !== "DONE") {
    await prisma.eInvoiceDocument.update({ where: { id }, data: { nextAt: new Date(Date.now() + 2 * 60_000), lastError: "Waiting for the certified invoice number." } });
    return "QUEUED";
  }
  const s = await einvoiceSettings();
  const format = d.format as EFormat;
  const provider = d.provider as EProvider;
  let edoc: EDoc;
  try { edoc = await edocFor(d); } catch (e) {
    await prisma.eInvoiceDocument.update({ where: { id }, data: { status: "FAILED", lastError: `Could not read the document: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500) } });
    return "FAILED";
  }
  const findings: Finding[] = s.validateBeforeSend ? validateEDoc(edoc, format) : [];
  if (hasErrors(findings, s.blockOnWarnings)) {
    const was = d.status;
    await prisma.eInvoiceDocument.update({ where: { id }, data: { status: "INVALID", validation: findings as unknown as Prisma.InputJsonValue, number: edoc.number, nextAt: null } });
    await event(prisma, id, "INVALID", `Stopped before sending: ${findings.filter((f) => f.severity === "error").map((f) => f.code).join(", ") || "warnings"}.`, findings as unknown as Prisma.InputJsonValue);
    if (was !== "INVALID") await alertFinance("einvoice.invalid", id, { number: edoc.number, reason: findings.find((f) => f.severity === "error")?.message ?? findings[0]?.message ?? "" });
    return "INVALID";
  }
  if (providerMode(provider) === "off") {
    await prisma.eInvoiceDocument.update({ where: { id }, data: { nextAt: new Date(Date.now() + 60 * 60_000), lastError: `${PROVIDER_INFO[provider].label} is not connected on the server yet.`, validation: findings as unknown as Prisma.InputJsonValue } });
    return "QUEUED";
  }
  const at = new Date();
  const { xml, huella } = renderXml(format, edoc, { progressivo: id.replace(/[^a-z0-9]/gi, "").slice(-10).toUpperCase(), at });
  const xmlBuf = Buffer.from(xml, "utf8");
  const needPdf = format === "FACTURX" || provider === "email" || (s.countries[d.countryCode]?.emailCopy ?? false);
  let pdf = needPdf ? await pdfFor(d) : null;
  if (format === "FACTURX" && pdf) pdf = await embedFacturX(pdf, xml, edoc.number);
  const stamp = at.toISOString().slice(0, 7).replace("-", "/");
  const xmlKey = `einvoice/${stamp}/${id}-${d.attempts + 1}.xml`;
  await putObject(xmlKey, xmlBuf, "application/xml");
  const pdfKey = pdf ? `einvoice/${stamp}/${id}-${d.attempts + 1}.pdf` : null;
  if (pdf && pdfKey) await putObject(pdfKey, pdf, "application/pdf");
  const base = { xmlKey, pdfKey, sha256: sha256(xmlBuf), number: edoc.number, language: edoc.language, validation: findings as unknown as Prisma.InputJsonValue, ...(huella ? { parsed: { huella } } : {}) };
  const profile = d.counterparty?.einvoiceProfile;
  try {
    const r = await adapter(provider).send({
      docId: id, format, kind: d.kind, number: edoc.number, fileName: xmlFileName(format, edoc.number, edoc.seller.vatId), xml: format === "FACTURX" && pdf ? pdf : xmlBuf, pdf,
      sender: { peppolId: edoc.seller.peppolId, vatId: edoc.seller.vatId, countryCode: edoc.seller.countryCode, name: edoc.seller.name },
      receiver: { peppolId: edoc.buyer.peppolId, email: profile?.invoiceEmail ?? edoc.buyer.email, countryCode: edoc.buyer.countryCode, sdiCode: profile?.sdiCode ?? null, pec: profile?.pecEmail ?? null, name: edoc.buyer.name },
      language: edoc.language,
    });
    const done = r.status === "DELIVERED" || r.status === "ACCEPTED";
    await prisma.eInvoiceDocument.update({
      where: { id },
      data: { ...base, status: r.status, externalId: r.externalId, networkRef: r.networkRef ?? null, attempts: d.attempts + 1, nextAt: null, lastError: null, sentAt: at, ...(done ? { deliveredAt: at } : {}), responseNote: r.note ?? null },
    });
    await event(prisma, id, r.status, `${r.status === "SENT" ? "Sent" : r.status === "ACCEPTED" ? "Sent and accepted" : "Delivered"} via ${PROVIDER_INFO[provider].label}${r.networkRef ? ` — ref. ${r.networkRef}` : ""}.`, { externalId: r.externalId, sha256: base.sha256 });
    // a copy by e-mail (the PDF, and the XML when FIRINGI chose so), when FIRINGI chose so for the country
    if (provider !== "email" && s.countries[d.countryCode]?.emailCopy && (pdf || s.emailXml) && profile?.delivery !== "EINVOICE") {
      const to = profile?.invoiceEmail ?? d.counterparty?.email;
      if (to) {
        const { sendMail } = await import("@/server/services/mailer");
        const { docTexts } = await import("./doc-i18n");
        const t = docTexts(edoc.language);
        const title = edoc.kind === "CREDIT_NOTE" ? t.title_CREDIT_NOTE : edoc.kind.startsWith("SELF_BILLED") ? t.title_SELF_BILLED : t.title_INVOICE;
        const safe = edoc.number.replace(/[^\w.-]+/g, "_");
        await sendMail({
          to, subject: `${edoc.seller.name} — ${title} ${edoc.number}`,
          text: [`${title} ${edoc.number}`, `${t.eInvoice}: ${format}${r.networkRef ? ` · ${t.networkRef}: ${r.networkRef}` : ""}`, "", edoc.seller.name].join("\n"),
          attachments: [
            ...(pdf ? [{ filename: `${safe}.pdf`, content: pdf }] : []),
            ...(s.emailXml ? [{ filename: xmlFileName(format, edoc.number, edoc.seller.vatId).replace(/^factur-x\.xml$/, `${safe}.xml`), content: xmlBuf }] : []),
          ],
        });
        await event(prisma, id, r.status, `Copy e-mailed to ${to} (${[pdf ? "PDF" : null, s.emailXml ? "XML" : null].filter(Boolean).join(" + ")}).`);
      }
    }
    return r.status;
  } catch (e) {
    const err = e instanceof EInvoiceError ? e : new EInvoiceError(e instanceof Error ? e.message : String(e), true);
    const attempts = d.attempts + 1;
    const giveUp = !err.retryable || attempts >= MAX_ATTEMPTS;
    await prisma.eInvoiceDocument.update({
      where: { id },
      data: { ...base, attempts, lastError: err.message.slice(0, 500), status: giveUp ? "FAILED" : "QUEUED", nextAt: giveUp ? null : new Date(Date.now() + BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000) },
    });
    await event(prisma, id, giveUp ? "FAILED" : "QUEUED", giveUp ? `Could not be sent: ${err.message}` : `Not sent (attempt ${attempts}), retrying: ${err.message}`);
    if (giveUp) await alertFinance("einvoice.failed", id, { number: edoc.number, reason: err.message.slice(0, 200) });
    return giveUp ? "FAILED" : "QUEUED";
  }
}

/** Follow sent documents: delivered → accepted / rejected (clearance systems clear or reject). */
export async function pollStatuses(limit = 50) {
  const open = await prisma.eInvoiceDocument.findMany({
    where: { direction: "OUTBOUND", status: { in: ["SENT", "DELIVERED"] }, externalId: { not: null } },
    orderBy: { updatedAt: "asc" }, take: limit,
    select: { id: true, status: true, provider: true, externalId: true, format: true, number: true, counterparty: { select: { legalName: true, einvoiceProfile: { select: { peppolId: true, sdiCode: true } } } } },
  });
  let changed = 0;
  for (const d of open) {
    try {
      const r = await adapter(d.provider as EProvider).status(d.externalId!, d.status as "SENT" | "DELIVERED", { format: d.format, receiver: [d.counterparty?.legalName, d.counterparty?.einvoiceProfile?.peppolId, d.counterparty?.einvoiceProfile?.sdiCode].filter(Boolean).join(" ") });
      if (r.status === d.status) continue;
      changed++;
      const now = new Date();
      await prisma.eInvoiceDocument.update({
        where: { id: d.id },
        data: { status: r.status, ...(r.networkRef ? { networkRef: r.networkRef } : {}), responseNote: r.note ?? null, ...(r.status === "DELIVERED" ? { deliveredAt: now } : {}), ...(r.status === "ACCEPTED" || r.status === "REJECTED" ? { respondedAt: now } : {}) },
      });
      await event(prisma, d.id, r.status, r.note ?? r.status);
      if (r.status === "REJECTED") await alertFinance("einvoice.rejected", d.id, { number: d.number, reason: r.note ?? "" });
    } catch (e) {
      await event(prisma, d.id, d.status, `Status check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return changed;
}

/** The queue: due documents (invoices before credit notes), status follow-up, and the services' inboxes. */
export async function processEInvoiceQueue(limit = 25) {
  const due = await prisma.eInvoiceDocument.findMany({
    where: { direction: "OUTBOUND", status: "QUEUED", OR: [{ nextAt: null }, { nextAt: { lte: new Date() } }] },
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }], take: limit, select: { id: true },
  });
  const out: Record<string, number> = {};
  for (const d of due) {
    const r = (await processDocument(d.id)) ?? "SKIPPED";
    out[r] = (out[r] ?? 0) + 1;
  }
  const statusChanges = await pollStatuses();
  const received = await pullInboxes();
  // the accountants' monthly packs, from FIRINGI's day of the month on (each company once a month)
  const packs = await (await import("./monthly")).runMonthlyPacks().catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  return { processed: due.length, ...out, statusChanges, received, packs };
}

/** After a transaction that queued documents: try them now (best effort; the cron retries). */
export function kickEInvoiceQueue() {
  void processEInvoiceQueue().catch((e) => console.error("[einvoice] queue", e));
}

// ── finance actions on a document ───────────────────────────────────────────

/** Check (and show) what would be sent, without sending. */
export async function checkDocument(ctx: Ctx, id: string) {
  assertAdmin(ctx);
  const d = await prisma.eInvoiceDocument.findUnique({ where: { id } });
  if (!d || d.direction !== "OUTBOUND") throw new NotFoundError("E-invoice");
  const edoc = await edocFor(d);
  const findings = validateEDoc(edoc, d.format as EFormat);
  const { xml } = renderXml(d.format as EFormat, edoc, { progressivo: id.replace(/[^a-z0-9]/gi, "").slice(-10).toUpperCase() });
  return { findings, xml, edoc };
}

/** Send again after fixing the cause (data, settings, connection). Rejected documents can be re-sent as they are. */
export async function resendDocument(ctx: Ctx, id: string) {
  assertAdmin(ctx, true);
  const d = await prisma.eInvoiceDocument.findUnique({ where: { id } });
  if (!d || d.direction !== "OUTBOUND") throw new NotFoundError("E-invoice");
  if (!["INVALID", "FAILED", "REJECTED", "QUEUED"].includes(d.status)) throw new ValidationError("Only documents that were stopped, failed or rejected can be sent again.");
  await prisma.eInvoiceDocument.update({ where: { id }, data: { status: "QUEUED", nextAt: null, lastError: null, validation: undefined, ...(d.status !== "QUEUED" ? { attempts: d.status === "REJECTED" ? d.attempts : 0 } : {}) } });
  await event(prisma, id, "QUEUED", "Queued again by finance.", undefined, ctx.user.id);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "einvoice.resend", entityType: "EInvoiceDocument", entityId: id, before: { status: d.status } });
  return processDocument(id);
}

/** Send an issued document that was not queued (e.g. the customer gave its Peppol id later). */
export async function sendExisting(ctx: Ctx, invoiceId: string) {
  assertAdmin(ctx, true);
  const open = await prisma.eInvoiceDocument.findFirst({ where: { invoiceId, direction: "OUTBOUND", status: { notIn: ["REJECTED", "FAILED", "INVALID"] } } });
  if (open) throw new ValidationError("This document is already on its way electronically.");
  const doc = await prisma.$transaction((tx) => queueForInvoice(tx, invoiceId));
  if (!doc) throw new ValidationError("No e-invoice route applies to this customer (country route off, or the customer has no Peppol id / did not choose e-invoices).");
  await event(prisma, doc.id, "QUEUED", "Queued by finance.", undefined, ctx.user.id);
  return processDocument(doc.id);
}

// ── receiving supplier e-invoices ───────────────────────────────────────────

const FORMAT_OF: Record<ParsedInvoice["format"], EFormat> = { UBL: "PEPPOL_BIS3", CII: "FACTURX", KSEF: "KSEF_FA3" };

async function supplierFor(p: ParsedInvoice) {
  if (p.seller.peppolId) {
    const prof = await prisma.eInvoiceProfile.findFirst({ where: { peppolId: p.seller.peppolId }, select: { companyId: true } });
    if (prof) return prisma.company.findUnique({ where: { id: prof.companyId }, include: { country: true } });
  }
  const ids = [p.seller.vatId, p.seller.taxId].filter((x): x is string => !!x).map((v) => v.replace(/\s+/g, "").toUpperCase());
  if (!ids.length) return null;
  const bare = ids.map((v) => v.replace(/^[A-Z]{2}/, ""));
  return prisma.company.findFirst({ where: { type: { in: ["DISTRIBUTOR", "WHOLESALER"] }, OR: [{ vatNumber: { in: [...ids, ...bare] } }, { taxId: { in: [...ids, ...bare] } }] }, include: { country: true } });
}

/**
 * A supplier e-invoice arrived (a service's inbox, the inbound webhook, or the simulator). It is archived, read and
 * matched: the statement it names (its number or the order number) or the one open statement with the same total.
 */
export async function receiveSupplierXml(xml: string, meta: { provider: string; externalId?: string | null; fileName?: string | null }) {
  const s = await einvoiceSettings();
  if (!s.enabled || !s.documents.receiveSupplier) return null;
  if (meta.externalId) {
    const dup = await prisma.eInvoiceDocument.findFirst({ where: { direction: "INBOUND", externalId: meta.externalId } });
    if (dup) return dup;
  }
  const parsed = parseEInvoice(xml);
  const buf = Buffer.from(xml, "utf8");
  const stamp = new Date().toISOString().slice(0, 7).replace("-", "/");
  const tmpId = `in-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const xmlKey = `einvoice/${stamp}/${tmpId}.xml`;
  await putObject(xmlKey, buf, "application/xml");
  const supplier = parsed ? await supplierFor(parsed) : null;
  const cc = supplier?.country.code ?? parsed?.seller.vatId?.slice(0, 2).toUpperCase() ?? "PT";
  const doc = await prisma.eInvoiceDocument.create({
    data: {
      direction: "INBOUND", kind: "SUPPLIER_INVOICE", status: "RECEIVED", counterpartyId: supplier?.id ?? null, countryCode: cc,
      format: parsed ? FORMAT_OF[parsed.format] : "PEPPOL_BIS3", channel: PROVIDER_INFO[(meta.provider as EProvider)]?.channel ?? "PEPPOL", provider: meta.provider,
      number: parsed?.number || meta.fileName || tmpId, xmlKey, sha256: sha256(buf), externalId: meta.externalId ?? null,
      parsed: (parsed ?? { unreadable: true }) as unknown as Prisma.InputJsonValue, archiveUntil: retentionUntil(s, cc),
      validation: (!parsed ? [{ code: "IN-01", severity: "error", message: "The XML could not be read as UBL, CII or KSeF." }] : !supplier ? [{ code: "IN-02", severity: "error", message: `No supplier on FIRINGI has the VAT / Peppol id ${parsed.seller.vatId ?? parsed.seller.peppolId ?? "—"}.` }] : []) as Prisma.InputJsonValue,
    },
  });
  await event(prisma, doc.id, "RECEIVED", parsed ? `Received ${parsed.credit ? "credit note" : "invoice"} ${parsed.number} from ${parsed.seller.name ?? "?"} (${parsed.gross.toFixed(2)} ${parsed.currency}).` : "Received a document that could not be read.");
  if (parsed && supplier) await matchInbound(doc.id, parsed, supplier.id, s);
  const after = await prisma.eInvoiceDocument.findUniqueOrThrow({ where: { id: doc.id } });
  if (after.status !== "MATCHED") await alertFinance("einvoice.received", doc.id, { number: after.number, reason: after.responseNote ?? "Not matched to a statement" });
  return after;
}

async function matchInbound(docId: string, p: ParsedInvoice, vendorCompanyId: string, s: EInvoiceSettings) {
  const open = await prisma.vendorBillingStatement.findMany({
    where: { vendorCompanyId, status: { in: ["OPEN", "DISPUTED"] }, isCreditStatement: p.credit },
    include: { order: { select: { number: true } } }, orderBy: { createdAt: "asc" },
  });
  const refs = p.references.join(" ");
  let chosen = open.filter((st) => refs.includes(st.number) || refs.includes(st.order.number) || (st.selfBilledNumber && refs.includes(st.selfBilledNumber)));
  if (!chosen.length) {
    const gross = new Decimal(p.gross);
    chosen = open.filter((st) => {
      const exp = p.currency !== "EUR" && st.currencyCode === p.currency ? st.expectedGrossLocal : st.expectedGross;
      return exp != null && gross.minus(exp.toString()).abs().lte(s.autoMatchTolerance);
    }).slice(0, 1);
  }
  if (!chosen.length) {
    await prisma.eInvoiceDocument.update({ where: { id: docId }, data: { responseNote: "No open billing statement with this reference or total — match it by hand." } });
    await event(prisma, docId, "RECEIVED", "Not matched: no open statement with this reference or total.");
    return;
  }
  const { checkVendorInvoice, recordVendorInvoice } = await import("@/server/services/finance");
  const docType = p.credit ? "CREDIT_NOTE" : "INVOICE";
  try {
    await checkVendorInvoice(vendorCompanyId, { statementIds: chosen.map((c) => c.id), docType, externalNumber: p.number });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.eInvoiceDocument.update({ where: { id: docId }, data: { responseNote: msg.slice(0, 300) } });
    await event(prisma, docId, "RECEIVED", `Not matched: ${msg}`);
    return;
  }
  const d = await prisma.eInvoiceDocument.findUniqueOrThrow({ where: { id: docId }, select: { xmlKey: true } });
  const vi = await recordVendorInvoice({
    vendorCompanyId, statementIds: chosen.map((c) => c.id), docType, externalNumber: p.number, issueDate: p.issueDate ? new Date(p.issueDate) : new Date(),
    netTotal: p.net.toFixed(2), vatTotal: p.vat.toFixed(2), fileKey: d.xmlKey!, source: "EINVOICE", structuredData: p as unknown as Prisma.InputJsonValue, actorUserId: null, actorCompanyId: null,
  });
  const ok = vi.status === "MATCHED";
  await prisma.eInvoiceDocument.update({ where: { id: docId }, data: { status: ok ? "MATCHED" : "RECEIVED", vendorInvoiceId: vi.id, statementId: chosen[0].id, responseNote: ok ? `Matched to ${chosen.map((c) => c.number).join(", ")}` : `Recorded against ${chosen.map((c) => c.number).join(", ")} — amounts differ, finance must review.` } });
  await event(prisma, docId, ok ? "MATCHED" : "RECEIVED", ok ? `Matched to ${chosen.map((c) => c.number).join(", ")}; recorded as supplier invoice.` : "Recorded, but the amounts differ from the statement (disputed).");
}

/** Pull new documents from every connected service's inbox (live services only). */
async function pullInboxes() {
  const s = await einvoiceSettings();
  if (!s.enabled || !s.documents.receiveSupplier) return 0;
  const used = new Set(Object.values(s.countries).filter((r) => r.enabled).map((r) => r.provider));
  let n = 0;
  for (const p of used) {
    if (p === "email" || providerMode(p) !== "live") continue;
    try {
      const items = (await adapter(p).inbox?.()) ?? [];
      for (const it of items) { await receiveSupplierXml(it.xml, { provider: p, externalId: it.externalId, fileName: it.fileName }); n++; }
    } catch (e) { console.error("[einvoice] inbox", p, e); }
  }
  return n;
}

/**
 * Demo / test: a supplier sends its e-invoice for a statement through the network (built-in network only). The
 * supplier's invoice mirrors the statement, optionally with a different net amount to show a dispute.
 */
export async function simulateSupplierEInvoice(ctx: Ctx | null, statementId: string, opts: { netDelta?: number; number?: string } = {}) {
  if (ctx) assertAdmin(ctx, true);
  if (!simulating()) throw new ValidationError("Only with the built-in test network (EINVOICE_SIMULATE=1).");
  const { doc } = await statementEDoc(statementId);
  const st = await prisma.vendorBillingStatement.findUniqueOrThrow({ where: { id: statementId }, select: { number: true } });
  const delta = new Decimal(opts.netDelta ?? 0);
  const net = new Decimal(doc.totals.net).plus(delta);
  const sup: EDoc = {
    ...doc, typeCode: doc.typeCode === "261" ? "381" : doc.typeCode === "389" ? "380" : doc.typeCode, kind: doc.kind === "SELF_BILLED_CREDIT" ? "CREDIT_NOTE" : "INVOICE",
    number: opts.number ?? `SUP-${st.number}`, buyerReference: st.number, notes: [`Statement ${st.number}`],
    totals: { ...doc.totals, lineNet: net.toFixed(2), net: net.toFixed(2), gross: net.plus(doc.totals.vat).toFixed(2), payable: net.plus(doc.totals.vat).toFixed(2) },
    lines: delta.isZero() ? doc.lines : [...doc.lines, { id: String(doc.lines.length + 1), name: "Adjustment", sku: null, qty: "1", unitCode: "C62", price: delta.toFixed(2), listPrice: delta.toFixed(2), discount: "0", net: delta.toFixed(2), vatCategory: "Z", vatRate: "0" }],
  };
  const { toUbl } = await import("./formats");
  return receiveSupplierXml(toUbl(sup, "PEPPOL_BIS3"), { provider: "peppol-ap", externalId: `sim-in-${statementId}-${opts.number ?? "1"}`, fileName: `${sup.number}.xml` });
}

// ── profiles (customers / suppliers) ────────────────────────────────────────

export type ProfileInput = {
  delivery: "EINVOICE" | "EMAIL" | "BOTH"; peppolId: string | null; invoiceLanguage: string | null; secondLanguage: string | null;
  ksefNip: string | null; sdiCode: string | null; pecEmail: string | null; leitwegId: string | null; invoiceEmail: string | null;
  accountantEmail?: string | null;
  selfBilling?: boolean; selfBillingAgreement?: string | null;
};

function canEditProfile(ctx: Ctx, companyId: string) {
  if (isStaff(ctx)) return can(ctx, ["admin.customers.manage", "admin.settings.manage", "admin.finance.manage"]);
  return ctx.company.id === companyId && can(ctx, ["company.profile.manage", "company.accounting.manage"]);
}

export async function getProfile(ctx: Ctx, companyId = ctx.company.id) {
  if (!(isStaff(ctx) || ctx.company.id === companyId)) throw new ForbiddenError();
  const co = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { id: true, legalName: true, type: true, taxId: true, vatNumber: true, email: true, country: { select: { code: true, name: true, defaultLanguageCode: true } }, einvoiceProfile: true } });
  const s = await einvoiceSettings();
  const route = s.countries[co.country.code];
  const docs = await prisma.eInvoiceDocument.findMany({ where: { counterpartyId: companyId }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, number: true, kind: true, direction: true, status: true, format: true, networkRef: true, createdAt: true, invoiceId: true, sentAt: true, deliveredAt: true } });
  return {
    company: co, profile: co.einvoiceProfile, route: s.enabled && route?.enabled ? route : null,
    settings: { allowCustomerLanguage: s.allowCustomerLanguage, allowBilingual: s.allowBilingual, selfBilling: s.enabled && s.documents.selfBilling, monthlyPack: s.monthlyPack.enabled, packDay: s.monthlyPack.day },
    documents: docs, canEdit: canEditProfile(ctx, companyId),
  };
}

export async function saveProfile(ctx: Ctx, input: ProfileInput, companyId = ctx.company.id) {
  if (!canEditProfile(ctx, companyId)) throw new ForbiddenError();
  const co = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { type: true, country: { select: { code: true } } } });
  const s = await einvoiceSettings();
  const clean = (v: string | null | undefined) => (v ?? "").trim() || null;
  const peppolId = clean(input.peppolId);
  if (peppolId && !PEPPOL_ID.test(peppolId)) throw new ValidationError("A Peppol id looks like 0208:0123456789 (scheme number, colon, identifier).");
  const sdi = clean(input.sdiCode)?.toUpperCase() ?? null;
  if (sdi && !/^[A-Z0-9]{7}$/.test(sdi)) throw new ValidationError("The SDI recipient code has 7 letters or digits.");
  const nip = clean(input.ksefNip)?.replace(/\D/g, "") ?? null;
  if (nip && nip.length !== 10) throw new ValidationError("A Polish NIP has 10 digits.");
  const lang = s.allowCustomerLanguage ? clean(input.invoiceLanguage) : null;
  const second = s.allowBilingual && s.allowCustomerLanguage ? clean(input.secondLanguage) : null;
  if ((lang && !isDocLanguage(lang)) || (second && !isDocLanguage(second))) throw new ValidationError("Choose a language from the list.");
  const email = clean(input.invoiceEmail);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError("Enter a valid e-mail address.");
  const accountant = clean(input.accountantEmail);
  if (accountant && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(accountant)) throw new ValidationError("Enter a valid e-mail address for your accountant.");
  const vendor = co.type === "DISTRIBUTOR" || co.type === "WHOLESALER";
  const before = await prisma.eInvoiceProfile.findUnique({ where: { companyId } });
  const selfBilling = vendor && s.documents.selfBilling ? !!input.selfBilling : false;
  const data = {
    delivery: ["EINVOICE", "EMAIL", "BOTH"].includes(input.delivery) ? input.delivery : "BOTH", peppolId, invoiceLanguage: lang, secondLanguage: second && second !== lang ? second : null,
    ksefNip: nip, sdiCode: sdi, pecEmail: clean(input.pecEmail), leitwegId: clean(input.leitwegId), invoiceEmail: email,
    ...(input.accountantEmail !== undefined ? { accountantEmail: accountant } : {}),
    selfBilling, selfBillingSince: selfBilling ? (before?.selfBilling ? before.selfBillingSince : new Date()) : null,
    selfBillingAgreement: selfBilling ? (clean(input.selfBillingAgreement) ?? before?.selfBillingAgreement ?? `SB-${companyId.slice(-6).toUpperCase()}-${new Date().getFullYear()}`) : null,
    updatedById: ctx.user.id,
  };
  const saved = await prisma.eInvoiceProfile.upsert({ where: { companyId }, update: data, create: { companyId, ...data } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "einvoice.profile", entityType: "Company", entityId: companyId, before, after: saved });
  return saved;
}

// ── lists, overview, archive ────────────────────────────────────────────────

export async function einvoiceOverview(ctx: Ctx) {
  assertAdmin(ctx);
  const s = await einvoiceSettings();
  const since = new Date(Date.now() - 30 * 86400_000);
  const [byStatus, byCountry, attention, recent] = await Promise.all([
    prisma.eInvoiceDocument.groupBy({ by: ["direction", "status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.eInvoiceDocument.groupBy({ by: ["countryCode", "format"], where: { createdAt: { gte: since }, direction: "OUTBOUND" }, _count: { _all: true } }),
    prisma.eInvoiceDocument.findMany({ where: { OR: [{ status: { in: ["INVALID", "FAILED", "REJECTED"] } }, { direction: "INBOUND", status: "RECEIVED" }, { status: "QUEUED", lastError: { not: null } }] }, orderBy: { updatedAt: "desc" }, take: 50, include: { counterparty: { select: { legalName: true } } } }),
    prisma.eInvoiceDocument.findMany({ orderBy: { createdAt: "desc" }, take: 25, include: { counterparty: { select: { legalName: true } } } }),
  ]);
  const providers = (Object.keys(PROVIDER_INFO) as EProvider[]).map((p) => ({ key: p, label: PROVIDER_INFO[p].label, mode: providerMode(p), countries: Object.entries(s.countries).filter(([, r]) => r.enabled && r.provider === p).map(([c]) => c) }));
  return { settings: s, byStatus, byCountry, attention, recent, providers };
}

export async function listDocuments(ctx: Ctx, f: { direction?: "OUTBOUND" | "INBOUND"; status?: string; country?: string; q?: string; from?: Date; to?: Date } = {}) {
  assertAdmin(ctx);
  return prisma.eInvoiceDocument.findMany({
    where: {
      ...(f.direction ? { direction: f.direction } : {}), ...(f.status ? { status: f.status as EInvoiceStatus } : {}), ...(f.country ? { countryCode: f.country } : {}),
      ...(f.q ? { OR: [{ number: { contains: f.q, mode: "insensitive" } }, { networkRef: { contains: f.q } }, { counterparty: { legalName: { contains: f.q, mode: "insensitive" } } }] } : {}),
      ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    },
    orderBy: { createdAt: "desc" }, take: 500, include: { counterparty: { select: { legalName: true } } },
  });
}

export async function documentDetail(ctx: Ctx, id: string) {
  assertAdmin(ctx);
  const d = await prisma.eInvoiceDocument.findUnique({
    where: { id },
    include: { events: { orderBy: { at: "asc" } }, counterparty: { select: { id: true, legalName: true, type: true } }, invoice: { select: { id: true, fullNumber: true, providerNumber: true, docType: true, grossTotal: true, currencyCode: true, grossTotalLocal: true } }, statement: { select: { id: true, number: true } }, vendorInvoice: { select: { id: true, externalNumber: true, status: true } } },
  });
  if (!d) throw new NotFoundError("E-invoice");
  const xml = d.xmlKey ? (await readStored(d.xmlKey).catch(() => null))?.toString("utf8") ?? null : null;
  const intact = xml != null && d.sha256 ? sha256(Buffer.from(xml, "utf8")) === d.sha256 : null;
  return { ...d, xml, intact };
}

/** The XML / PDF of a document for its counterparty (customer / supplier) or FIRINGI. */
export async function documentFile(ctx: Ctx, id: string, kind: "xml" | "pdf") {
  const d = await prisma.eInvoiceDocument.findUnique({ where: { id } });
  if (!d) throw new NotFoundError("E-invoice");
  const mine = d.counterpartyId === ctx.company.id && can(ctx, ["buyer.invoices.view", "vendor.invoices.view", "vendor.invoices.submit", "buyer.payments.view"]);
  if (!mine) assertAdmin(ctx);
  const key = kind === "xml" ? d.xmlKey : d.pdfKey;
  if (!key) throw new NotFoundError("File");
  return { buf: await readStored(key), name: `${d.number.replace(/[^\w.-]+/g, "_")}.${kind}`, type: kind === "xml" ? "application/xml" : "application/pdf" };
}

/** The e-invoice status of a company's own documents (customer / supplier pages). */
export async function myEInvoiceStatus(ctx: Ctx, invoiceIds: string[]) {
  if (!invoiceIds.length) return new Map<string, { id: string; status: EInvoiceStatus; format: string; networkRef: string | null }>();
  const rows = await prisma.eInvoiceDocument.findMany({ where: { invoiceId: { in: invoiceIds }, counterpartyId: ctx.company.id, direction: "OUTBOUND" }, orderBy: { createdAt: "asc" }, select: { id: true, invoiceId: true, status: true, format: true, networkRef: true } });
  return new Map(rows.map((r) => [r.invoiceId!, { id: r.id, status: r.status, format: r.format, networkRef: r.networkRef }]));
}

/** Archive check: every stored file still has the hash it was archived with. */
export async function verifyArchive(ctx: Ctx, f: { from?: Date; to?: Date } = {}) {
  assertAdmin(ctx);
  const docs = await prisma.eInvoiceDocument.findMany({ where: { xmlKey: { not: null }, ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}) }, select: { id: true, number: true, xmlKey: true, sha256: true } });
  const broken: { id: string; number: string; reason: string }[] = [];
  for (const d of docs) {
    const b = await readStored(d.xmlKey!).catch(() => null);
    if (!b) broken.push({ id: d.id, number: d.number, reason: "file missing" });
    else if (d.sha256 && sha256(b) !== d.sha256) broken.push({ id: d.id, number: d.number, reason: "hash differs" });
  }
  return { checked: docs.length, intact: docs.length - broken.length, broken };
}

/**
 * Auditor export: every e-invoice of a period (sent and received) as stored — XML and PDF — with a manifest of
 * numbers, statuses, network references and SHA-256 hashes (a ZIP).
 */
export async function auditExport(ctx: Ctx, f: { from: Date; to: Date; country?: string }) {
  assertAdmin(ctx);
  const docs = await prisma.eInvoiceDocument.findMany({
    where: { createdAt: { gte: f.from, lte: f.to }, xmlKey: { not: null }, ...(f.country ? { countryCode: f.country } : {}) },
    orderBy: { createdAt: "asc" }, include: { counterparty: { select: { legalName: true, vatNumber: true } } },
  });
  const files: Record<string, Uint8Array> = {};
  const csv = ["id;direction;kind;number;counterparty;counterparty_vat;country;format;channel;status;network_ref;sent_at;delivered_at;sha256;intact;archive_until;xml_file;pdf_file"];
  for (const d of docs) {
    const folder = `${d.direction.toLowerCase()}/${d.countryCode}`;
    const safe = d.number.replace(/[^\w.-]+/g, "_");
    const xml = await readStored(d.xmlKey!).catch(() => null);
    const xf = xml ? `${folder}/${safe}.xml` : "";
    if (xml) files[xf] = new Uint8Array(xml);
    let pf = "";
    if (d.pdfKey) { const pdf = await readStored(d.pdfKey).catch(() => null); if (pdf) { pf = `${folder}/${safe}.pdf`; files[pf] = new Uint8Array(pdf); } }
    const intact = xml && d.sha256 ? sha256(xml) === d.sha256 : false;
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    csv.push([d.id, d.direction, d.kind, d.number, d.counterparty?.legalName, d.counterparty?.vatNumber, d.countryCode, d.format, d.channel, d.status, d.networkRef, d.sentAt?.toISOString(), d.deliveredAt?.toISOString(), d.sha256, intact ? "yes" : "NO", d.archiveUntil?.toISOString().slice(0, 10), xf, pf].map(q).join(";"));
  }
  files["manifest.csv"] = strToU8(csv.join("\n") + "\n");
  files["README.txt"] = strToU8([
    "FIRINGI — e-invoice archive export",
    `Period: ${f.from.toISOString().slice(0, 10)} to ${f.to.toISOString().slice(0, 10)}${f.country ? ` · country ${f.country}` : ""}`,
    `Documents: ${docs.length}`,
    `Exported: ${new Date().toISOString()} by ${ctx.user.email ? "FIRINGI finance" : "FIRINGI"}`,
    "",
    "manifest.csv lists every document with its SHA-256 hash as archived when it was sent / received;",
    "'intact' = the stored file still has that hash. Files are in outbound|inbound/<country>/.",
  ].join("\n") + "\n");
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "einvoice.audit_export", entityType: "EInvoiceDocument", entityId: "archive", after: { from: f.from, to: f.to, country: f.country ?? null, count: docs.length } });
  return { zip: Buffer.from(zipSync(files, { level: 6 })), count: docs.length };
}

export { vatWithPrefix };

// ── FIRINGI's own companies (legal entities) ────────────────────────────────

export async function entitiesForSettings(ctx: Ctx) {
  assertAdmin(ctx);
  return prisma.legalEntity.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" }, include: { country: { select: { code: true, flag: true, defaultLanguageCode: true } } } });
}

/** An entity's document language, optional second language, own-language rule and Peppol id. */
export async function saveEntityEInvoice(ctx: Ctx, id: string, i: { language: string | null; secondLanguage: string | null; requireOwnLanguage: boolean; peppolId: string | null }) {
  assertAdmin(ctx, true);
  const cur = await prisma.legalEntity.findUnique({ where: { id } });
  if (!cur) throw new NotFoundError("FIRINGI company");
  const peppolId = (i.peppolId ?? "").trim() || null;
  if (peppolId && !PEPPOL_ID.test(peppolId)) throw new ValidationError("A Peppol id looks like 9946:PT515000001 (scheme number, colon, identifier).");
  if ((i.language && !isDocLanguage(i.language)) || (i.secondLanguage && !isDocLanguage(i.secondLanguage))) throw new ValidationError("Choose a language from the list.");
  const data = { language: i.language || null, secondLanguage: i.secondLanguage && i.secondLanguage !== i.language ? i.secondLanguage : null, requireOwnLanguage: i.requireOwnLanguage, peppolId };
  const row = await prisma.legalEntity.update({ where: { id }, data });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "legal_entity.einvoice", entityType: "LegalEntity", entityId: id, before: { language: cur.language, secondLanguage: cur.secondLanguage, requireOwnLanguage: cur.requireOwnLanguage, peppolId: cur.peppolId }, after: data });
  return row;
}

// ── small reads for pages ───────────────────────────────────────────────────

export async function countriesForSettings(ctx: Ctx) {
  assertAdmin(ctx);
  const { SCHENGEN } = await import("@/lib/einvoice");
  return prisma.country.findMany({ where: { code: { in: [...SCHENGEN] } }, select: { code: true, name: true, flag: true }, orderBy: { code: "asc" } });
}

/** Open statements to receive a test supplier e-invoice for (built-in test network only). */
export async function openStatementsForTest(ctx: Ctx) {
  assertAdmin(ctx, true);
  if (!simulating()) return [];
  return prisma.vendorBillingStatement.findMany({ where: { status: { in: ["OPEN", "DISPUTED"] } }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, number: true, expectedGross: true, currencyCode: true, expectedGrossLocal: true, vendor: { select: { legalName: true } } } });
}

/** E-invoice status of documents in a list (a customer sees only its own). */
export async function einvoiceStatusFor(ctx: Ctx, invoiceIds: string[], as: "BUYER" | "ADMIN") {
  if (!invoiceIds.length) return new Map<string, { id: string; status: EInvoiceStatus; format: string; networkRef: string | null }>();
  if (as === "ADMIN") assertAdmin(ctx);
  const rows = await prisma.eInvoiceDocument.findMany({
    where: { invoiceId: { in: invoiceIds }, direction: "OUTBOUND", ...(as === "BUYER" ? { counterpartyId: ctx.company.id } : {}) },
    orderBy: { createdAt: "asc" }, select: { id: true, invoiceId: true, status: true, format: true, networkRef: true },
  });
  return new Map(rows.map((d) => [d.invoiceId!, { id: d.id, status: d.status, format: d.format, networkRef: d.networkRef }]));
}
