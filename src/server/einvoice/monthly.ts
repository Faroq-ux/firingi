/**
 * Phase 46 — the monthly pack for a company's accountant: every document FIRINGI issued to the company in a month
 * (invoices, credit notes, service invoices, and a supplier's self-billed invoices) as XML — the e-invoice exactly as
 * it was sent when there is one, otherwise a Peppol BIS 3 file made for the accountant — plus one PDF with the month's
 * totals. Sent on the day of the month FIRINGI chose (cron), downloadable by the company, sendable by hand.
 */
import "server-only";
import { zipSync, strToU8 } from "fflate";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { readStored } from "@/server/services/storage";
import { PERIOD, documentLanguages, periodRange, previousPeriod } from "@/lib/einvoice";
import { toUbl } from "./formats";
import { invoiceEDoc, statementEDoc } from "./model";
import { einvoiceSettings } from "./service";
import type { MonthlyRow } from "@/server/pdf/monthly";

const safe = (n: string) => n.replace(/[^\w.-]+/g, "_");

/**
 * The documents of a company's month, their XML and the summary rows — in two sides that are never added together:
 * IN  = invoices FIRINGI issued to the company (its purchases on FIRINGI, ads, plans, fees: costs for the company);
 * OUT = the company's own invoices to FIRINGI for what it sold through FIRINGI (income): the self-billed invoices
 *       FIRINGI issued in its name, and the invoices it sent FIRINGI itself (uploaded or as an e-invoice).
 */
async function collect(companyId: string, period: string, withInvoicePdfs: boolean) {
  const { from, to } = periodRange(period);
  const invoices = await prisma.invoice.findMany({
    where: { recipientCompanyId: companyId, status: { not: "DRAFT" }, issuedAt: { gte: from, lt: to } },
    orderBy: { issuedAt: "asc" }, include: { lines: true },
  });
  const statements = await prisma.vendorBillingStatement.findMany({ where: { vendorCompanyId: companyId, selfBilledNumber: { not: null }, selfBilledAt: { gte: from, lt: to } }, orderBy: { selfBilledAt: "asc" } });
  const own = await prisma.vendorInvoice.findMany({
    where: { vendorCompanyId: companyId, source: { not: "SELF_BILLED" }, status: { not: "REJECTED" }, issueDate: { gte: from, lt: to } },
    orderBy: { issueDate: "asc" }, include: { einvoices: { where: { direction: "INBOUND", xmlKey: { not: null } }, select: { xmlKey: true }, take: 1 } },
  });
  const files: Record<string, Uint8Array> = {};
  const rows: MonthlyRow[] = [];
  const sentXml = async (where: { invoiceId?: string; statementId?: string }) => {
    const d = await prisma.eInvoiceDocument.findFirst({ where: { ...where, direction: "OUTBOUND", status: { in: ["SENT", "DELIVERED", "ACCEPTED"] }, xmlKey: { not: null } }, orderBy: { createdAt: "desc" }, select: { xmlKey: true } });
    return d?.xmlKey ? readStored(d.xmlKey).catch(() => null) : null;
  };
  const rates = (doc: { taxes: { rate: string; base: string; vat: string }[] }) => doc.taxes.map((t) => ({ rate: Number(t.rate), base: Number(t.base), vat: Number(t.vat) }));
  for (const inv of invoices) {
    const { doc } = await invoiceEDoc(inv.id);
    const xml = (await sentXml({ invoiceId: inv.id })) ?? Buffer.from(toUbl(doc, "PEPPOL_BIS3"), "utf8");
    files[`xml/from-firingi/${safe(doc.number)}.xml`] = new Uint8Array(xml);
    if (withInvoicePdfs) {
      const { invoicePdfData } = await import("@/server/data/finance-docs");
      const { renderInvoicePdf } = await import("@/server/pdf/documents");
      files[`pdf/from-firingi/${safe(doc.number)}.pdf`] = new Uint8Array(await renderInvoicePdf(await invoicePdfData(null, inv.id)));
    }
    rows.push({ side: "IN", date: doc.issueDate, number: doc.number, kind: inv.docType, currency: doc.currency, net: Number(doc.totals.net), vat: Number(doc.totals.vat), gross: Number(doc.totals.gross), rates: rates(doc) });
  }
  for (const st of statements) {
    const { doc } = await statementEDoc(st.id);
    const xml = (await sentXml({ statementId: st.id })) ?? Buffer.from(toUbl(doc, "PEPPOL_BIS3"), "utf8");
    files[`xml/to-firingi/${safe(doc.number)}.xml`] = new Uint8Array(xml);
    if (withInvoicePdfs) {
      const { selfBilledPdf } = await import("./pdf");
      files[`pdf/to-firingi/${safe(doc.number)}.pdf`] = new Uint8Array(await selfBilledPdf(st.id));
    }
    rows.push({ side: "OUT", date: doc.issueDate, number: doc.number, kind: st.isCreditStatement ? "SELF_BILLED_CREDIT" : "SELF_BILLED", currency: doc.currency, net: Number(doc.totals.net), vat: Number(doc.totals.vat), gross: Number(doc.totals.gross), rates: rates(doc) });
  }
  for (const v of own) {
    // the company's own invoice to FIRINGI, as it sent it: the e-invoice XML, and the file it uploaded
    const key = v.einvoices[0]?.xmlKey;
    const xml = key ? await readStored(key).catch(() => null) : null;
    if (xml) files[`xml/to-firingi/${safe(v.externalNumber)}.xml`] = new Uint8Array(xml);
    const original = await readStored(v.fileKey).catch(() => null);
    if (original) {
      const ext = (v.fileKey.match(/\.(\w{2,5})$/)?.[1] ?? (original.subarray(0, 4).toString() === "%PDF" ? "pdf" : "bin")).toLowerCase();
      if (!(xml && ext === "xml")) files[`${ext === "xml" ? "xml" : "pdf"}/to-firingi/${safe(v.externalNumber)}.${ext}`] = new Uint8Array(original);
    }
    const local = v.currencyCode !== "EUR" && v.grossTotalLocal != null;
    const net = Number(local ? v.netTotalLocal : v.netTotal), vat = Number(local ? v.vatTotalLocal : v.vatTotal), gross = Number(local ? v.grossTotalLocal : v.grossTotal);
    rows.push({
      side: "OUT", date: v.issueDate.toISOString().slice(0, 10), number: v.externalNumber, kind: v.docType === "CREDIT_NOTE" ? "CREDIT_NOTE" : "INVOICE",
      currency: local ? v.currencyCode : "EUR", net, vat, gross, rates: [{ rate: -1, base: net, vat }],
    });
  }
  return { files, rows: rows.sort((a, b) => a.date.localeCompare(b.date)) };
}

/** The pack itself: the summary PDF and a ZIP of the XML (and the PDFs when FIRINGI chose so). */
export async function buildMonthlyPack(companyId: string, period: string) {
  if (!PERIOD.test(period)) throw new ValidationError("Choose a month (YYYY-MM).");
  const all = await einvoiceSettings();
  const s = all.monthlyPack;
  const co = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { legalName: true, taxId: true, vatNumber: true, countryId: true, country: { select: { defaultLanguageCode: true } }, einvoiceProfile: { select: { invoiceLanguage: true } } } });
  // the same language rule as the invoices (FIRINGI's priority: customer's country, its choice, FIRINGI's company)
  // the FIRINGI company that issued the month's documents (else the one in the company's country, else the first)
  const { from, to } = periodRange(period);
  const used = await prisma.invoice.findFirst({ where: { recipientCompanyId: companyId, status: { not: "DRAFT" }, issuedAt: { gte: from, lt: to } }, orderBy: { issuedAt: "desc" }, select: { legalEntityId: true } });
  const leSelect = { legalName: true, language: true, country: { select: { defaultLanguageCode: true } } } as const;
  const le = (used ? await prisma.legalEntity.findUnique({ where: { id: used.legalEntityId }, select: leSelect }) : null)
    ?? await prisma.legalEntity.findFirst({ where: { isActive: true, countryId: co.countryId }, select: leSelect })
    ?? await prisma.legalEntity.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: leSelect });
  const language = documentLanguages(all, {
    customerCountryLanguage: co.country.defaultLanguageCode, customerChoice: co.einvoiceProfile?.invoiceLanguage ?? null, customerSecond: null,
    entityLanguage: le?.language ?? le?.country.defaultLanguageCode ?? "en", entitySecond: null, requireOwnLanguage: false,
  }).primary;
  const { files, rows } = await collect(companyId, period, s.includeInvoicePdfs);
  const issuer = le?.legalName ?? "FIRINGI";
  const { renderMonthlyPdf } = await import("@/server/pdf/monthly");
  const summary = s.includeSummary ? Buffer.from(await renderMonthlyPdf({ language, period, company: { name: co.legalName, taxId: co.taxId, vatId: co.vatNumber }, issuer, rows, withXml: s.includeXml })) : null;
  const zipFiles: Record<string, Uint8Array> = {};
  // the company's own uploaded PDFs to FIRINGI come too when FIRINGI chose PDFs, or when there is no XML of them
  for (const [k, v] of Object.entries(files)) {
    if (k.startsWith("xml/") ? s.includeXml : (s.includeInvoicePdfs || (k.startsWith("pdf/to-firingi/") && !files[k.replace(/^pdf\//, "xml/").replace(/\.\w+$/, ".xml")]))) zipFiles[k] = v;
  }
  if (summary) zipFiles[`summary-${period}.pdf`] = new Uint8Array(summary);
  zipFiles["README.txt"] = strToU8(`FIRINGI — ${co.legalName} — ${period}\nDocuments: ${rows.length}\nfrom-firingi/: invoices FIRINGI issued to you (your purchases and services)\nto-firingi/: your invoices to FIRINGI (your sales: self-billed by FIRINGI in your name, or sent by you)\nxml/: e-invoices (as sent, or Peppol BIS 3)${s.includeInvoicePdfs ? "\npdf/: the documents as PDF" : ""}\n`);
  return { rows, summary, zip: Buffer.from(zipSync(zipFiles, { level: 6 })), language, name: co.legalName };
}

/** E-mail one company's pack to its accountant and record it. */
export async function sendMonthlyPack(companyId: string, period: string) {
  const prof = await prisma.eInvoiceProfile.findUnique({ where: { companyId }, select: { accountantEmail: true } });
  const to = prof?.accountantEmail;
  if (!to) throw new ValidationError("No accountant e-mail is set for this company.");
  try {
    const p = await buildMonthlyPack(companyId, period);
    if (!p.rows.length) {
      return prisma.eInvoiceMonthlyPack.upsert({ where: { companyId_period: { companyId, period } }, update: { status: "EMPTY", documentCount: 0, sentTo: to, error: null }, create: { companyId, period, status: "EMPTY", documentCount: 0, sentTo: to } });
    }
    const { docTexts } = await import("./doc-i18n");
    const t = docTexts(p.language);
    const { sendMail } = await import("@/server/services/mailer");
    await sendMail({
      to, subject: `FIRINGI — ${t.monthlySummary} ${period} — ${p.name}`,
      text: [t.packIntro, `${t.period}: ${period}`, `${t.count}: ${p.rows.length}`, "", t.attachedXml].join("\n"),
      attachments: [...(p.summary ? [{ filename: `FIRINGI-${period}-summary.pdf`, content: p.summary }] : []), { filename: `FIRINGI-${period}-${safe(p.name)}.zip`, content: p.zip }],
    });
    return prisma.eInvoiceMonthlyPack.upsert({
      where: { companyId_period: { companyId, period } },
      update: { status: "SENT", documentCount: p.rows.length, sentTo: to, sentAt: new Date(), error: null },
      create: { companyId, period, status: "SENT", documentCount: p.rows.length, sentTo: to, sentAt: new Date() },
    });
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await prisma.eInvoiceMonthlyPack.upsert({ where: { companyId_period: { companyId, period } }, update: { status: "FAILED", error, sentTo: to }, create: { companyId, period, status: "FAILED", error, sentTo: to } });
    throw e;
  }
}

/**
 * The scheduler (every run of the e-invoice cron): from FIRINGI's day of the month on, each company with an accountant
 * e-mail gets last month's pack once. `force` = FIRINGI sends now, whatever the day.
 */
export async function runMonthlyPacks(now = new Date(), force = false) {
  const s = (await einvoiceSettings()).monthlyPack;
  if (!s.enabled && !force) return { sent: 0, skipped: "off" };
  if (!force && now.getUTCDate() < s.day) return { sent: 0, skipped: `waits for day ${s.day}` };
  const period = previousPeriod(now);
  const profiles = await prisma.eInvoiceProfile.findMany({ where: { accountantEmail: { not: null } }, select: { companyId: true } });
  const done = new Set((await prisma.eInvoiceMonthlyPack.findMany({ where: { period, status: { in: ["SENT", "EMPTY"] } }, select: { companyId: true } })).map((p) => p.companyId));
  let sent = 0, empty = 0, failed = 0;
  for (const p of profiles) {
    if (done.has(p.companyId)) continue;
    try {
      const r = await sendMonthlyPack(p.companyId, period);
      if (r.status === "SENT") sent++; else empty++;
    } catch { failed++; }
  }
  return { period, sent, empty, failed };
}

// ── for pages and actions ───────────────────────────────────────────────────

function mayUse(ctx: Ctx, companyId: string) {
  if (ctx.company.type === "ADMIN") return can(ctx, ["admin.finance.manage", "admin.finance.view", "admin.invoices.view", "admin.settings.manage"]);
  return ctx.company.id === companyId && can(ctx, ["company.profile.manage", "company.accounting.manage", "company.accounting.view", "buyer.invoices.view", "vendor.invoices.view"]);
}

export async function myPacks(ctx: Ctx, companyId = ctx.company.id) {
  if (!mayUse(ctx, companyId)) throw new ForbiddenError();
  return prisma.eInvoiceMonthlyPack.findMany({ where: { companyId }, orderBy: { period: "desc" }, take: 24 });
}

export async function downloadPack(ctx: Ctx, period: string, companyId = ctx.company.id) {
  if (!mayUse(ctx, companyId)) throw new ForbiddenError();
  return buildMonthlyPack(companyId, period);
}

export async function sendPackNow(ctx: Ctx, period: string, companyId = ctx.company.id) {
  if (!mayUse(ctx, companyId)) throw new ForbiddenError();
  if (!PERIOD.test(period)) throw new ValidationError("Choose a month (YYYY-MM).");
  return sendMonthlyPack(companyId, period);
}

export async function recentPacks(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.finance.view", "admin.invoices.view", "admin.settings.manage"])) throw new ForbiddenError();
  const [packs, withAccountant] = await Promise.all([
    prisma.eInvoiceMonthlyPack.findMany({ orderBy: { updatedAt: "desc" }, take: 30, include: { company: { select: { legalName: true } } } }),
    prisma.eInvoiceProfile.count({ where: { accountantEmail: { not: null } } }),
  ]);
  return { packs, withAccountant };
}

export async function runPacksNow(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.finance.manage", "admin.settings.manage"])) throw new ForbiddenError();
  return runMonthlyPacks(new Date(), true);
}
