import "server-only";
/**
 * Printing (Services): print suppliers (approved by FIRINGI for the PRINTING service, like any service provider) list
 * what they print — shelf labels, leaflets, menus, posters, stickers, business cards, banners… — with a price per item
 * + setup (minimum and step quantities) or "price on request". Customers order with their files (PDF / images), or
 * send shelf labels straight from their shelf-labels page (the print-ready PDF is made for the supplier). The supplier
 * accepts or quotes, prints and delivers (or has it ready to pick up). Who invoices the customer is FIRINGI's choice
 * (per service, per supplier): FIRINGI invoices and pays the supplier its amount, or the supplier invoices and FIRINGI
 * earns a commission, invoiced to the supplier monthly with the other services. The customer never sees the commission.
 */
import type { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { nextNumber } from "@/server/services/orders";
import { PRINT_DELIVERY, PRINT_KINDS, PRINT_OPEN, nextSteps, printMoney, printPrice, qtyOk, type PrintDelivery, type PrintKind } from "@/lib/printing";
import { LABEL_FORMATS, cleanCustom, customFormat, type CustomSize, type LabelFields } from "@/lib/shelf-labels";
import { ensureBuiltIns, isStaff, pricingOf } from "./catalogue";
import { customerOn, providerOn, servicesSettings } from "./settings";

const n = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));
const nameOf = (c: { legalName: string; tradeName: string | null } | null | undefined) => c?.tradeName ?? c?.legalName ?? "—";
const CODE = "PRINTING";

async function printingType() {
  await ensureBuiltIns();
  return prisma.serviceType.findUniqueOrThrow({ where: { code: CODE } });
}

// ── who may ─────────────────────────────────────────────────────────────────

/** May this customer order printing (services on, printing active in its country)? */
export async function printAccess(ctx: Ctx) {
  if (isStaff(ctx) || !(ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER")) return { on: false, order: false };
  const [s, t] = await Promise.all([servicesSettings(), printingType()]);
  const on = customerOn(s, ctx.company) && t.active && (!t.countries.length || t.countries.includes(ctx.company.countryCode)) && can(ctx, ["buyer.services.manage", "buyer.services.log"]);
  return { on, order: on && can(ctx, "buyer.services.manage") };
}
async function assertCustomer(ctx: Ctx, order = false) {
  const a = await printAccess(ctx);
  if (!a.on || (order && !a.order)) throw new AppError("FEATURE_OFF", "Printing isn't available for your company.", 403);
}
/** The supplier's approved printing provider rows (FIRINGI staff: FIRINGI's own). */
async function myPrintProviders(ctx: Ctx, manage = false) {
  const t = await printingType();
  if (isStaff(ctx)) { if (!can(ctx, ["admin.services.manage"])) throw new ForbiddenError(); }
  else {
    if (!can(ctx, manage ? ["vendor.services.manage"] : ["vendor.services.manage", "vendor.services.visit"])) throw new ForbiddenError();
    if (!providerOn(await servicesSettings(), ctx.company)) throw new AppError("FEATURE_OFF", "FIRINGI hasn't switched services on for your company.", 403);
  }
  return prisma.serviceProvider.findMany({ where: { companyId: ctx.company.id, serviceTypeId: t.id, status: "APPROVED" }, include: { serviceType: true } });
}

// ── the supplier's products ─────────────────────────────────────────────────

export type PrintProductInput = {
  kind: PrintKind; name: string; description?: string | null; labelFormat?: string | null; customSize?: Partial<CustomSize> | null;
  unitPriceNet: number; setupNet: number; minQty: number; stepQty: number; priceOnRequest: boolean; vatRate: number; turnaroundDays: number; delivery: PrintDelivery[]; active: boolean;
};
export async function printBoard(ctx: Ctx) {
  const provs = await myPrintProviders(ctx);
  const ids = provs.map((p) => p.id);
  const [products, jobs] = await Promise.all([
    prisma.printProduct.findMany({ where: { providerId: { in: ids } }, orderBy: [{ active: "desc" }, { kind: "asc" }, { name: "asc" }] }),
    prisma.printJob.findMany({ where: { providerId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 200, include: { product: { select: { name: true, priceOnRequest: true } } } }),
  ]);
  const cos = await prisma.company.findMany({ where: { id: { in: jobs.map((j) => j.customerCompanyId) } }, select: { id: true, legalName: true, tradeName: true } });
  const pr = provs[0] ? pricingOf(provs[0].serviceType, provs[0]) : null;
  return {
    approved: provs.length > 0, providerId: provs[0]?.id ?? null,
    terms: pr ? { invoicedBy: ctx.company.type === "ADMIN" ? "FIRINGI" : pr.invoicedBy, commissionPct: pr.commissionPct } : null,
    products,
    jobs: jobs.map((j) => ({ ...j, customer: nameOf(cos.find((c) => c.id === j.customerCompanyId)), steps: nextSteps(j.status, "PROVIDER", j.product.priceOnRequest) })),
  };
}
export async function savePrintProduct(ctx: Ctx, id: string | null, i: PrintProductInput) {
  const provs = await myPrintProviders(ctx, true);
  if (!provs.length) throw new ValidationError("FIRINGI hasn't approved you for printing yet.");
  if (!(PRINT_KINDS as readonly string[]).includes(i.kind)) throw new ValidationError("Choose what it is.");
  if (i.name.trim().length < 2) throw new ValidationError("Name the product.");
  if (!(i.unitPriceNet >= 0 && i.setupNet >= 0)) throw new ValidationError("Prices can't be negative.");
  if (!i.priceOnRequest && !(i.unitPriceNet > 0 || i.setupNet > 0)) throw new ValidationError("Enter a price, or choose price on request.");
  const delivery = [...new Set(i.delivery.filter((d) => (PRINT_DELIVERY as readonly string[]).includes(d)))];
  if (!delivery.length) throw new ValidationError("Choose delivery and / or pick-up.");
  let labelFormat: string | null = null, customSize: Prisma.InputJsonValue | typeof undefined = undefined;
  if (i.kind === "SHELF_LABELS") {
    labelFormat = i.labelFormat ?? "A4_21";
    if (labelFormat !== "CUSTOM" && !(LABEL_FORMATS as readonly string[]).includes(labelFormat)) throw new ValidationError("Choose the label size.");
    if (labelFormat === "CUSTOM") { const c = cleanCustom(i.customSize); if (!customFormat(c)) throw new ValidationError("This label size does not fit on an A4 page."); customSize = c as unknown as Prisma.InputJsonValue; }
  }
  const data = {
    kind: i.kind, name: i.name.trim().slice(0, 120), description: i.description?.trim().slice(0, 1000) || null, labelFormat, ...(customSize ? { customSize } : {}),
    unitPriceNet: i.unitPriceNet, setupNet: i.setupNet, minQty: Math.max(1, Math.round(i.minQty)), stepQty: Math.max(1, Math.round(i.stepQty)),
    priceOnRequest: i.priceOnRequest, vatRate: Math.min(30, Math.max(0, i.vatRate)), turnaroundDays: Math.min(60, Math.max(0, Math.round(i.turnaroundDays))), delivery, active: i.active,
  };
  if (id) {
    const p = await prisma.printProduct.findFirst({ where: { id, providerId: { in: provs.map((x) => x.id) } } });
    if (!p) throw new NotFoundError("Product");
    return prisma.printProduct.update({ where: { id }, data });
  }
  return prisma.printProduct.create({ data: { ...data, providerId: provs[0].id } });
}

// ── customers ───────────────────────────────────────────────────────────────

/** What the customer can order: active products of approved print suppliers covering its country. */
export async function printCatalogue(ctx: Ctx) {
  await assertCustomer(ctx);
  const t = await printingType();
  const provs = await prisma.serviceProvider.findMany({ where: { serviceTypeId: t.id, status: "APPROVED" } });
  const ok = provs.filter((p) => !p.countries.length || p.countries.includes(ctx.company.countryCode));
  const products = await prisma.printProduct.findMany({ where: { active: true, providerId: { in: ok.map((p) => p.id) } }, orderBy: [{ kind: "asc" }, { unitPriceNet: "asc" }] });
  const cos = await prisma.company.findMany({ where: { id: { in: ok.map((p) => p.companyId) } }, select: { id: true, legalName: true, tradeName: true } });
  const supplier = (providerId: string) => nameOf(cos.find((c) => c.id === ok.find((p) => p.id === providerId)?.companyId));
  return products.map((p) => ({ ...p, supplier: supplier(p.providerId) }));
}

export type PrintOrderInput = {
  productId: string; qty: number; title: string; notes?: string | null; delivery: PrintDelivery; addressId?: string | null; wantedBy?: Date | null;
  artwork?: { key: string; fileName: string }[]; labelIds?: string[]; labelFields?: LabelFields; copies?: number;
};
/** The customer orders. Shelf labels: the print-ready PDF is made now and the labels count as printed. */
export async function orderPrint(ctx: Ctx, i: PrintOrderInput, locale = "en") {
  await assertCustomer(ctx, true);
  const p = await prisma.printProduct.findUnique({ where: { id: i.productId }, include: { provider: { include: { serviceType: true } } } });
  const catalogue = await printCatalogue(ctx);
  if (!p || !catalogue.some((c) => c.id === p.id)) throw new NotFoundError("Product");
  if (!p.delivery.includes(i.delivery)) throw new ValidationError("This supplier doesn't offer that delivery.");
  const labels = p.kind === "SHELF_LABELS" && i.labelIds?.length;
  const copies = Math.max(1, Math.min(50, Math.round(i.copies ?? 1)));
  const qty = labels ? i.labelIds!.length * copies : Math.round(i.qty);
  if (!qtyOk({ minQty: p.minQty, stepQty: labels ? 1 : p.stepQty }, qty)) throw new ValidationError(labels ? `At least ${p.minQty} labels for this product.` : `Quantity: at least ${p.minQty}${p.stepQty > 1 ? `, in steps of ${p.stepQty}` : ""}.`);
  if (!labels && !(i.artwork?.length) && !i.notes?.trim()) throw new ValidationError("Add your files, or describe what to print.");
  // only files this company uploaded
  if ((i.artwork ?? []).some((a) => !a.key.startsWith(`print-artwork/${ctx.company.id}/`))) throw new ValidationError("Upload your files again.");
  let address: string | null = null;
  if (i.delivery === "DELIVERY") {
    const a = i.addressId ? await prisma.address.findFirst({ where: { id: i.addressId, companyId: ctx.company.id, isActive: true } }) : await prisma.address.findFirst({ where: { companyId: ctx.company.id, kind: "DELIVERY", isActive: true }, orderBy: { createdAt: "asc" } });
    if (!a) throw new ValidationError("Add a delivery address first.");
    address = a.id;
  }
  let pdfKey: string | null = null;
  if (labels) {
    const { printLabels } = await import("@/server/labels/service");
    const fmt = (p.labelFormat ?? "A4_21") as Parameters<typeof printLabels>[2];
    const pdf = await printLabels(ctx, i.labelIds!, fmt, i.labelFields ?? { brand: true, origin: false, code: "BARCODE", unitPrice: true, shopName: false, date: true }, locale, copies, fmt === "CUSTOM" ? { custom: (p.customSize ?? undefined) as Partial<CustomSize> | undefined } : {});
    const { putObject } = await import("@/server/services/storage");
    const { randomUUID } = await import("node:crypto");
    pdfKey = `print/${new Date().getFullYear()}/${randomUUID()}.pdf`;
    await putObject(pdfKey, pdf, "application/pdf");
  }
  const priceNet = p.priceOnRequest ? 0 : printPrice({ unitPriceNet: n(p.unitPriceNet), setupNet: n(p.setupNet) }, qty);
  const job = await prisma.$transaction(async (tx) => tx.printJob.create({
    data: {
      number: await nextNumber(tx, "print_job", "PJ"), customerCompanyId: ctx.company.id, providerId: p.providerId, productId: p.id, kind: p.kind, qty,
      title: i.title.trim().slice(0, 120) || p.name, notes: i.notes?.trim().slice(0, 2000) || null,
      artworkKeys: (i.artwork ?? []).slice(0, 10).map((a) => a.key), artworkNames: (i.artwork ?? []).slice(0, 10).map((a) => a.fileName.slice(0, 120)),
      labelIds: labels ? i.labelIds! : [], pdfKey, delivery: i.delivery, addressId: address, wantedBy: i.wantedBy ?? null,
      priceNet, vatRate: p.vatRate, createdById: ctx.user.id,
    },
  }));
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "print.ordered", entityType: "PrintJob", entityId: job.id, after: { number: job.number, product: p.name, qty, priceNet } });
  const { notify } = await import("@/server/notify/dispatch");
  await notify("print.job_new", [{ companyId: p.provider.companyId, link: "/vendor/services/printing" }], { number: job.number, customer: nameOf(await prisma.company.findUnique({ where: { id: ctx.company.id }, select: { legalName: true, tradeName: true } })), product: `${p.name} × ${qty}` }, { ref: { type: "PrintJob", id: job.id } }).catch(() => null);
  return job;
}

export async function myPrintJobs(ctx: Ctx) {
  await assertCustomer(ctx);
  const jobs = await prisma.printJob.findMany({ where: { customerCompanyId: ctx.company.id }, orderBy: { createdAt: "desc" }, take: 100, include: { product: { select: { name: true, priceOnRequest: true, providerId: true } } } });
  const provs = await prisma.serviceProvider.findMany({ where: { id: { in: jobs.map((j) => j.providerId) } }, select: { id: true, companyId: true } });
  const cos = await prisma.company.findMany({ where: { id: { in: provs.map((p) => p.companyId) } }, select: { id: true, legalName: true, tradeName: true } });
  // the customer sees its price — never the supplier's amount or FIRINGI's commission
  return jobs.map((j) => ({
    id: j.id, number: j.number, title: j.title, kind: j.kind, qty: j.qty, status: j.status, priceNet: n(j.priceNet), vatRate: n(j.vatRate), product: j.product.name,
    supplier: nameOf(cos.find((c) => c.id === provs.find((p) => p.id === j.providerId)?.companyId)), delivery: j.delivery, quoteNote: j.quoteNote, readyBy: j.readyBy,
    deliveredAt: j.deliveredAt, rejectReason: j.rejectReason, createdAt: j.createdAt, files: j.artworkNames, hasPdf: !!j.pdfKey, steps: nextSteps(j.status, "CUSTOMER", j.product.priceOnRequest),
  }));
}

async function jobFor(ctx: Ctx, id: string, side: "CUSTOMER" | "PROVIDER") {
  const j = await prisma.printJob.findUnique({ where: { id }, include: { product: true, provider: { include: { serviceType: true } } } });
  if (!j) throw new NotFoundError("Print order");
  if (side === "CUSTOMER") { await assertCustomer(ctx); if (j.customerCompanyId !== ctx.company.id) throw new NotFoundError("Print order"); }
  else if (!(await myPrintProviders(ctx)).some((p) => p.id === j.providerId)) throw new NotFoundError("Print order");
  return j;
}
const step = (j: { status: string; product: { priceOnRequest: boolean } }, side: "PROVIDER" | "CUSTOMER", s: string) => {
  if (!nextSteps(j.status, side, j.product.priceOnRequest).includes(s)) throw new ValidationError("This order can't do that now.");
};
async function tellCustomer(j: { id: string; number: string; customerCompanyId: string }, status: string, amount?: string) {
  const { notify } = await import("@/server/notify/dispatch");
  if (status === "QUOTED") await notify("print.quoted", [{ companyId: j.customerCompanyId, link: "/buy/services/printing" }], { number: j.number, amount: amount ?? "" }, { ref: { type: "PrintJob", id: j.id } }).catch(() => null);
  else await notify("print.job_update", [{ companyId: j.customerCompanyId, link: "/buy/services/printing" }], { number: j.number, status }, { ref: { type: "PrintJob", id: j.id } }).catch(() => null);
}

/** The supplier: accept (fixed price), quote, start printing, deliver, or reject. */
export async function printStep(ctx: Ctx, id: string, i: { step: "ACCEPT" | "QUOTE" | "PRINTING" | "DELIVERED" | "REJECT"; priceNet?: number | null; note?: string | null; readyBy?: Date | null; providerInvoiceNo?: string | null }, now = new Date()) {
  const j = await jobFor(ctx, id, "PROVIDER");
  step(j, "PROVIDER", i.step);
  let data: Prisma.PrintJobUpdateInput = {};
  if (i.step === "ACCEPT") data = { status: "ACCEPTED", acceptedAt: now, readyBy: i.readyBy ?? new Date(now.getTime() + j.product.turnaroundDays * 86_400_000) };
  if (i.step === "QUOTE") {
    if (!(Number(i.priceNet) > 0)) throw new ValidationError("Enter your price.");
    data = { status: "QUOTED", priceNet: Math.round(Number(i.priceNet) * 100) / 100, quoteNote: i.note?.trim().slice(0, 500) || null, quotedAt: now, readyBy: i.readyBy ?? null };
  }
  if (i.step === "REJECT") { if (!i.note?.trim()) throw new ValidationError("Say why."); data = { status: "REJECTED", rejectReason: i.note.trim().slice(0, 300) }; }
  if (i.step === "PRINTING") data = { status: "PRINTING" };
  if (i.step === "DELIVERED") return deliverPrint(ctx, j, i.providerInvoiceNo ?? null, now);
  const r = await prisma.printJob.update({ where: { id }, data });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `print.${i.step.toLowerCase()}`, entityType: "PrintJob", entityId: id, after: { number: j.number, priceNet: n(r.priceNet) } });
  await tellCustomer(j, r.status, i.step === "QUOTE" ? `${n(r.priceNet).toFixed(2)} €` : undefined);
  return r;
}

/** Delivered (or picked up): FIRINGI invoices the customer and owes the supplier its amount — or the supplier invoiced and owes FIRINGI the commission. */
async function deliverPrint(ctx: Ctx, j: Awaited<ReturnType<typeof jobFor>>, providerInvoiceNo: string | null, now: Date) {
  const s = await servicesSettings();
  const pricing = pricingOf(j.provider.serviceType, j.provider);
  const by = (await prisma.company.findUnique({ where: { id: j.provider.companyId }, select: { type: true } }))?.type === "ADMIN" ? "FIRINGI" : pricing.invoicedBy;
  const price = n(j.priceNet);
  if (by === "PROVIDER" && price > 0 && !providerInvoiceNo?.trim()) throw new ValidationError("You invoice this customer yourself — enter your invoice number.");
  const m = printMoney(price, pricing.commissionPct, by);
  await prisma.$transaction(async (tx) => {
    let invoiceId: string | null = null;
    if (by === "FIRINGI" && s.parts.invoicing && price > 0) {
      const { issueServiceInvoice } = await import("@/server/invoicing/service");
      const inv = await issueServiceInvoice(tx, { recipientCompanyId: j.customerCompanyId, docType: "INVOICE", dueDays: 15, actorUserId: ctx.user.id, lines: [{ description: `${j.product.name} — ${j.title} × ${j.qty} (${j.number})`, net: new Decimal(price) }] });
      invoiceId = inv.id;
    }
    await tx.printJob.update({ where: { id: j.id }, data: { status: "DELIVERED", deliveredAt: now, invoicedBy: by, providerAmount: m.provider, commissionNet: m.commission, invoiceId, providerInvoiceNo: providerInvoiceNo?.trim().slice(0, 60) || null } });
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "print.delivered", entityType: "PrintJob", entityId: j.id, after: { number: j.number, by, price, provider: m.provider, commission: m.commission } });
  await tellCustomer(j, "DELIVERED");
  return prisma.printJob.findUniqueOrThrow({ where: { id: j.id } });
}

/** The customer: accept a quote, or cancel before printing starts. */
export async function customerPrintStep(ctx: Ctx, id: string, s: "ACCEPT_QUOTE" | "CANCEL", now = new Date()) {
  await assertCustomer(ctx, true);
  const j = await jobFor(ctx, id, "CUSTOMER");
  step(j, "CUSTOMER", s);
  const r = await prisma.printJob.update({ where: { id }, data: s === "ACCEPT_QUOTE" ? { status: "ACCEPTED", acceptedAt: now, readyBy: j.readyBy ?? new Date(now.getTime() + j.product.turnaroundDays * 86_400_000) } : { status: "CANCELLED" } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: s === "CANCEL" ? "print.cancelled" : "print.quote_accepted", entityType: "PrintJob", entityId: id, after: { number: j.number } });
  const { notify } = await import("@/server/notify/dispatch");
  await notify("print.job_update", [{ companyId: j.provider.companyId, link: "/vendor/services/printing" }], { number: j.number, status: r.status }, { ref: { type: "PrintJob", id } }).catch(() => null);
  return r;
}

/** A file of an order (customer, its supplier, or FIRINGI staff): the print-ready labels PDF or the customer's file n. */
export async function printFileKey(ctx: Ctx, id: string, which: string) {
  const j = await prisma.printJob.findUnique({ where: { id } });
  if (!j) throw new NotFoundError("File");
  const staff = isStaff(ctx) && can(ctx, ["admin.services.view", "admin.services.manage"]);
  const mine = j.customerCompanyId === ctx.company.id;
  const supplier = !staff && !mine ? (await prisma.serviceProvider.findFirst({ where: { id: j.providerId, companyId: ctx.company.id } })) != null : false;
  if (!staff && !mine && !supplier) throw new NotFoundError("File");
  if (which === "pdf") { if (!j.pdfKey) throw new NotFoundError("File"); return { key: j.pdfKey, name: `${j.number}-labels.pdf` }; }
  const k = Number(which);
  if (!Number.isInteger(k) || !j.artworkKeys[k]) throw new NotFoundError("File");
  return { key: j.artworkKeys[k], name: j.artworkNames[k] ?? `${j.number}-${k + 1}` };
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export async function adminPrint(ctx: Ctx, status?: string | null) {
  if (!isStaff(ctx) || !can(ctx, ["admin.services.view", "admin.services.manage"])) throw new ForbiddenError();
  const where: Prisma.PrintJobWhereInput = status ? { status } : {};
  const [jobs, counts, products] = await Promise.all([
    prisma.printJob.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, include: { product: { select: { name: true } } } }),
    prisma.printJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.printProduct.count({ where: { active: true } }),
  ]);
  const provs = await prisma.serviceProvider.findMany({ where: { id: { in: jobs.map((j) => j.providerId) } }, select: { id: true, companyId: true } });
  const cos = await prisma.company.findMany({ where: { id: { in: [...jobs.map((j) => j.customerCompanyId), ...provs.map((p) => p.companyId)] } }, select: { id: true, legalName: true, tradeName: true } });
  const nm = (id?: string) => nameOf(cos.find((c) => c.id === id));
  return {
    products, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number>,
    jobs: jobs.map((j) => ({ ...j, customer: nm(j.customerCompanyId), supplier: nm(provs.find((p) => p.id === j.providerId)?.companyId) })),
    open: jobs.filter((j) => PRINT_OPEN.includes(j.status as never)).length,
  };
}
/** What FIRINGI owes print suppliers (FIRINGI invoiced the customer) and commissions not yet invoiced. */
export async function printMoneyOpen() {
  const rows = await prisma.printJob.findMany({ where: { status: "DELIVERED", OR: [{ invoicedBy: "FIRINGI", providerAmount: { gt: 0 }, providerPaidAt: null }, { invoicedBy: "PROVIDER", commissionNet: { gt: 0 }, commissionInvoiceId: null }] }, orderBy: { deliveredAt: "asc" }, take: 500 });
  return {
    rows, provider: Math.round(rows.filter((r) => r.invoicedBy === "FIRINGI").reduce((a, r) => a + n(r.providerAmount), 0) * 100) / 100,
    commission: Math.round(rows.filter((r) => r.invoicedBy === "PROVIDER").reduce((a, r) => a + n(r.commissionNet), 0) * 100) / 100,
  };
}
export async function markPrintPaid(ctx: Ctx, ids: string[], now = new Date()) {
  if (!isStaff(ctx) || !can(ctx, ["admin.services.manage"]) || !can(ctx, ["admin.finance.manage"])) throw new ForbiddenError("Recording payments needs the Finance right.");
  const r = await prisma.printJob.updateMany({ where: { id: { in: ids }, status: "DELIVERED", invoicedBy: "FIRINGI", providerPaidAt: null }, data: { providerPaidAt: now } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "print.paid", entityType: "PrintJob", entityId: ids[0] ?? "-", after: { ids, count: r.count } });
  return r.count;
}
/** FIRINGI's monthly commission invoices for print orders the suppliers invoiced themselves. */
export async function invoicePrintCommissions(actorUserId: string | null, before: Date) {
  const rows = await prisma.printJob.findMany({ where: { status: "DELIVERED", invoicedBy: "PROVIDER", commissionNet: { gt: 0 }, commissionInvoiceId: null, deliveredAt: { lt: before } }, include: { provider: true } });
  const byCo = new Map<string, typeof rows>();
  for (const r of rows) byCo.set(r.provider.companyId, [...(byCo.get(r.provider.companyId) ?? []), r]);
  const { issueServiceInvoice } = await import("@/server/invoicing/service");
  for (const [companyId, js] of byCo) {
    await prisma.$transaction(async (tx) => {
      const inv = await issueServiceInvoice(tx, { recipientCompanyId: companyId, docType: "INVOICE", dueDays: 15, actorUserId, lines: [{ description: `Comissão FIRINGI — Impressão: ${js.length} encomenda(s) (${js.map((x) => x.number).slice(0, 6).join(", ")}${js.length > 6 ? "…" : ""})`, net: js.reduce((a, x) => a.plus(x.commissionNet.toString()), new Decimal(0)) }] });
      await tx.printJob.updateMany({ where: { id: { in: js.map((x) => x.id) } }, data: { commissionInvoiceId: inv.id } });
    });
  }
  return byCo.size;
}
