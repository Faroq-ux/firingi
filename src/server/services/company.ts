/**
 * Company lifecycle: profile edits, applicant submission, admin decisions,
 * VIES checks and commission (no default commission — must be set per vendor).
 */
import type { AccountStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  ADMIN_TRANSITIONS, describeMissing, isVendorType, missingForApproval, missingForSubmission, type ReadinessInput,
} from "@/server/onboarding/rules";
import { canDecideType, canViewType, requireAdmin, scopeWhere } from "./admin-access";
import { applyBuyerDefaults } from "./payments";
import { convertMatchingLeads } from "./crm";
import { writeAudit } from "./audit";
import { notify } from "@/server/notify/dispatch";
import { checkVies } from "./vies";
import { checkCompanyVat } from "@/lib/tax-id";

/** Collect everything the readiness rules need about one company. */
export async function readinessInput(companyId: string): Promise<ReadinessInput & { status: AccountStatus }> {
  const c = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    include: {
      documents: { where: { driverId: null, restrictionApprovalId: null }, select: { type: true, status: true } },
      addresses: { select: { kind: true, isActive: true } },
      vatValidations: { orderBy: { checkedAt: "desc" }, take: 1, select: { result: true, vatNumber: true } },
      commissionRules: { where: { validTo: null }, take: 1, select: { id: true } },
    },
  });
  if (c.type === "ADMIN") throw new ForbiddenError();
  const last = c.vatValidations[0];
  return {
    type: c.type,
    status: c.status,
    documents: c.documents,
    addresses: c.addresses,
    vatNumber: c.vatNumber,
    viesValid: !!last && last.result === "VALID" && last.vatNumber === c.vatNumber,
    hasCommission: c.commissionRules.length > 0,
  };
}

// ── Applicant side ──────────────────────────────────────────────────────────

export type ProfileInput = {
  tradeName?: string | null; email: string; phone?: string | null; website?: string | null; businessType?: string | null;
  // Legal identity — only editable while the application is not yet approved.
  legalName?: string; vatNumber?: string | null;
};

export async function updateOwnProfile(ctx: Ctx, input: ProfileInput) {
  if (!can(ctx, "company.profile.manage")) throw new ForbiddenError();
  const before = await prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id } });
  const locked = before.status === "APPROVED" || before.status === "SUSPENDED" || before.status === "UNDER_REVIEW";
  if (locked && ((input.legalName && input.legalName !== before.legalName) || (input.vatNumber !== undefined && (input.vatNumber || null) !== before.vatNumber)))
    throw new ValidationError("Legal name and VAT number can't be changed after submission. Contact FIRINGI support.");
  const data: Prisma.CompanyUpdateInput = {
    tradeName: input.tradeName?.trim() || null,
    email: input.email.trim().toLowerCase(),
    phone: input.phone?.trim() || null,
    website: input.website?.trim() || null,
    ...(before.type === "CUSTOMER" ? { businessType: input.businessType || null } : {}),
    ...(!locked && input.legalName ? { legalName: input.legalName.trim() } : {}),
    ...(!locked && input.vatNumber !== undefined ? { vatNumber: input.vatNumber?.replace(/[\s.-]/g, "").toUpperCase() || null } : {}),
  };
  if (!locked && input.vatNumber !== undefined) {
    const country = await prisma.country.findUniqueOrThrow({ where: { id: before.countryId } });
    const v = checkCompanyVat(input.vatNumber, country, before.taxId);
    if (!v.ok) throw new ValidationError(v.error);
    data.vatNumber = v.vat;
  }
  const after = await prisma.company.update({ where: { id: ctx.company.id }, data });
  await writeAudit({
    actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "company.profile_updated", entityType: "Company", entityId: ctx.company.id,
    before: { tradeName: before.tradeName, email: before.email, phone: before.phone, legalName: before.legalName, vatNumber: before.vatNumber },
    after: { tradeName: after.tradeName, email: after.email, phone: after.phone, legalName: after.legalName, vatNumber: after.vatNumber },
  });
}

/** Applicant sends the completed application to FIRINGI (PENDING → UNDER_REVIEW). */
export async function submitForReview(ctx: Ctx) {
  if (!ctx.membership.isOwner && !can(ctx, "company.documents.manage")) throw new ForbiddenError();
  const r = await readinessInput(ctx.company.id);
  if (r.status !== "PENDING") throw new AppError("BAD_STATUS", "The application has already been submitted.");
  const missing = missingForSubmission(r);
  if (missing.length) throw new ValidationError(`Please complete your application: ${missing.map(describeMissing).join("; ")}.`);
  await transition(ctx.company.id, "PENDING", "UNDER_REVIEW", "Submitted by applicant", ctx);
}

// ── Admin side ──────────────────────────────────────────────────────────────

async function loadForAdmin(ctx: Ctx, companyId: string) {
  requireAdmin(ctx);
  const c = await prisma.company.findFirst({ where: { id: companyId, type: { not: "ADMIN" }, ...scopeWhere(ctx) } });
  if (!c || !canViewType(ctx, c.type)) throw new NotFoundError("Company");
  return c;
}

/** Admin decision: approve / reject / request changes / suspend / reactivate / reopen. */
export async function adminSetStatus(ctx: Ctx, companyId: string, to: AccountStatus, reason?: string | null) {
  const c = await loadForAdmin(ctx, companyId);
  if (!canDecideType(ctx, c.type)) throw new ForbiddenError();
  if (!ADMIN_TRANSITIONS[c.status].includes(to)) throw new AppError("BAD_TRANSITION", `Cannot change status from ${c.status} to ${to}.`);
  if (["REJECTED", "SUSPENDED"].includes(to) || (c.status === "UNDER_REVIEW" && to === "PENDING")) {
    if (!reason?.trim()) throw new ValidationError("Please give a reason — it is shown to the applicant.");
  }
  if (to === "APPROVED") {
    const missing = missingForApproval(await readinessInput(companyId));
    if (missing.length) throw new ValidationError(`Cannot approve yet: ${missing.map(describeMissing).join("; ")}.`);
  }
  await transition(companyId, c.status, to, reason ?? null, ctx);
}

async function transition(companyId: string, from: AccountStatus, to: AccountStatus, reason: string | null, ctx: Ctx) {
  await prisma.$transaction(async (tx) => {
    // Optimistic guard: only move if nobody changed the status in between.
    const res = await tx.company.updateMany({
      where: { id: companyId, status: from },
      data: {
        status: to,
        statusReason: ["REJECTED", "SUSPENDED", "PENDING"].includes(to) ? reason : null,
        ...(to === "APPROVED" ? { approvedAt: new Date(), approvedById: ctx.user.id } : {}),
      },
    });
    if (res.count !== 1) throw new AppError("CONFLICT", "The status was changed by someone else. Please reload.", 409);
    await tx.companyStatusHistory.create({ data: { companyId, fromStatus: from, toStatus: to, reason, byUserId: ctx.user.id } });
    if (to === "APPROVED") await applyBuyerDefaults(tx, companyId); // default payment terms / credit limit
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `company.status.${to.toLowerCase()}`, entityType: "Company", entityId: companyId, before: { status: from }, after: { status: to, reason } }, tx);
  });
  const notified: AccountStatus[] = ["UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED", "PENDING"];
  if (notified.includes(to)) await notify(`company.${to.toLowerCase()}`, [{ companyId, link: "/" }], { reason: reason ?? "" });
  if (to === "APPROVED") await convertMatchingLeads(companyId); // CRM: the lead that brought this company converts
}

/** Run the EU VIES check for a company's VAT number and record the result. */
export async function runViesCheck(ctx: Ctx, companyId: string, fetchImpl?: typeof fetch) {
  const c = await loadForAdmin(ctx, companyId);
  if (!c.vatNumber) throw new ValidationError("This company has no VAT number.");
  const country = await prisma.country.findUniqueOrThrow({ where: { id: c.countryId }, select: { isEU: true } });
  if (!country.isEU) throw new ValidationError("VIES covers EU VAT numbers only. Record a manual verification for this country.");
  const r = await checkVies(c.vatNumber, fetchImpl);
  const row = await prisma.vatValidation.create({
    data: {
      companyId, vatNumber: c.vatNumber, result: r.result, registeredName: r.registeredName ?? null,
      registeredAddress: r.registeredAddress ?? null, consultationRef: r.consultationRef ?? (r.error ? `error: ${r.error}`.slice(0, 190) : null),
      checkedById: ctx.user.id,
    },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "company.vies_checked", entityType: "Company", entityId: companyId, after: { vat: c.vatNumber, result: r.result, error: r.error } });
  return row;
}

/** When VIES is unavailable, compliance staff may record a manual verification (audited). */
export async function recordManualVatVerification(ctx: Ctx, companyId: string, note: string) {
  const c = await loadForAdmin(ctx, companyId);
  if (!can(ctx, "admin.risk.manage") && !canDecideType(ctx, c.type)) throw new ForbiddenError();
  if (!c.vatNumber) throw new ValidationError("This company has no VAT number.");
  if (note.trim().length < 10) throw new ValidationError("Describe how the VAT number was verified (at least 10 characters).");
  await prisma.vatValidation.create({
    data: { companyId, vatNumber: c.vatNumber, result: "VALID", consultationRef: `MANUAL: ${note.trim()}`.slice(0, 190), checkedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "company.vat_manually_verified", entityType: "Company", entityId: companyId, after: { vat: c.vatNumber, note } });
}

/**
 * Set a vendor's commission (percentage). The current rule is closed and a new rule
 * starts now, so history is preserved and orders keep the rate active when placed.
 */
export async function setCommissionRate(ctx: Ctx, vendorCompanyId: string, ratePercent: number, note?: string | null) {
  const c = await loadForAdmin(ctx, vendorCompanyId);
  if (!can(ctx, "admin.vendors.commission")) throw new ForbiddenError();
  if (!isVendorType(c.type)) throw new ValidationError("Commission applies to distributors and wholesalers only.");
  if (!(ratePercent >= 0 && ratePercent <= 100)) throw new ValidationError("Commission must be between 0 and 100 %.");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const current = await tx.commissionRule.findFirst({ where: { vendorCompanyId, validTo: null, categoryId: null } });
    if (current) await tx.commissionRule.update({ where: { id: current.id }, data: { validTo: now } });
    await tx.commissionRule.create({ data: { vendorCompanyId, type: "PERCENT", rate: ratePercent, validFrom: now, note: note ?? null, createdById: ctx.user.id } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "vendor.commission_set", entityType: "Company", entityId: vendorCompanyId, before: current ? { rate: current.rate.toString() } : null, after: { rate: ratePercent, note } }, tx);
  });
}
