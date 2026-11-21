/**
 * Company lifecycle: profile edits, applicant submission, admin decisions,
 * VIES checks and commission (no default commission — must be set per vendor).
 */
import { normalisePhone } from "@/server/notify/events";
import type { AccountStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  ADMIN_TRANSITIONS, blocking, describeMissing, isVendorType, missingForApproval, missingForSubmission, normaliseCertificateCode, waivable, type ReadinessInput,
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
    legalForm: c.legalForm,
    status: c.status,
    documents: c.documents,
    certificateCode: c.registryCertificateCode,
    addresses: c.addresses,
    vatNumber: c.vatNumber,
    viesValid: !!last && last.result === "VALID" && last.vatNumber === c.vatNumber,
    hasCommission: c.commissionRules.length > 0,
  };
}

// ── Applicant side ──────────────────────────────────────────────────────────

export type ProfileInput = {
  tradeName?: string | null; email: string; phone?: string | null; whatsapp?: string | null; website?: string | null; businessType?: string | null;
  // Legal identity — only editable while the application is not yet approved.
  legalName?: string; vatNumber?: string | null;
  /** Phase 28 — legal form is locked after submission; the certificate code can be renewed any time. */
  legalForm?: "COMPANY" | "SOLE_TRADER"; certificateCode?: string | null;
  /** economic activity code (CAE…): entered once if missing, then fixed (FIRINGI corrects it) */
  activityCode?: string | null;
  /** secondary activity codes to add (existing ones stay — only FIRINGI removes) */
  addActivityCodes?: string | null;
};

export async function updateOwnProfile(ctx: Ctx, input: ProfileInput) {
  if (!can(ctx, "company.profile.manage")) throw new ForbiddenError();
  const before = await prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id } });
  // Registration details (NIF, VAT number, legal name, legal form) are fixed: one company, one NIF. Only FIRINGI
  // corrects them (adminCorrectRegistration, with a reason). Addresses go through FIRINGI's approval instead.
  const locked = true;
  if ((input.legalName && input.legalName.trim() !== before.legalName) || (input.vatNumber !== undefined && (input.vatNumber?.replace(/[\s.-]/g, "").toUpperCase() || null) !== before.vatNumber))
    throw new ValidationError("Your registration details (NIF, VAT number, legal name) can't be changed. If something is wrong, contact FIRINGI support — FIRINGI corrects it.");
  const data: Prisma.CompanyUpdateInput = {
    tradeName: input.tradeName?.trim() || null,
    email: input.email.trim().toLowerCase(),
    phone: input.phone?.trim() || null,
    ...(input.whatsapp !== undefined ? { whatsapp: normalisePhone(input.whatsapp) ?? null } : {}),
    website: input.website?.trim() || null,
    ...(before.type === "CUSTOMER" ? { businessType: input.businessType || null } : {}),
    ...(!locked && input.legalName ? { legalName: input.legalName.trim() } : {}),
    ...(!locked && input.vatNumber !== undefined ? { vatNumber: input.vatNumber?.replace(/[\s.-]/g, "").toUpperCase() || null } : {}),
  };
  if (input.legalForm && input.legalForm !== before.legalForm) {
    if (locked) throw new ValidationError("The legal form is part of your registration and can't be changed. Contact FIRINGI support.");
    data.legalForm = input.legalForm;
  }
  if (input.activityCode?.trim()) {
    const country = await prisma.country.findUniqueOrThrow({ where: { id: before.countryId }, select: { code: true } });
    const { activityScheme, checkActivityCode } = await import("@/lib/activity-code");
    const a = checkActivityCode(input.activityCode, country.code);
    if (!a.ok) throw new ValidationError(`Enter your ${activityScheme(country.code).name} code (e.g. ${activityScheme(country.code).example}).`);
    if (before.activityCode && before.activityCode !== a.value) throw new ValidationError("Your activity code is part of your registration and can't be changed. Contact FIRINGI support.");
    data.activityCode = a.value;
  }
  if (input.addActivityCodes?.trim()) {
    const country = await prisma.country.findUniqueOrThrow({ where: { id: before.countryId }, select: { code: true } });
    const { activityScheme, parseActivityCodes, MAX_SECONDARY_ACTIVITY_CODES } = await import("@/lib/activity-code");
    const main = (data.activityCode as string | undefined) ?? before.activityCode;
    const p = parseActivityCodes([...before.activityCodes, ...input.addActivityCodes.split(/[,;\s]+/)], country.code, main);
    if (!p.ok) throw new ValidationError(`Check the secondary ${activityScheme(country.code).name} codes (${p.bad}) — up to ${MAX_SECONDARY_ACTIVITY_CODES}.`);
    data.activityCodes = p.values;
  }
  if (input.certificateCode !== undefined) {
    const raw = input.certificateCode?.trim() ?? "";
    if (!raw) data.registryCertificateCode = null;
    else {
      const country = await prisma.country.findUniqueOrThrow({ where: { id: before.countryId }, select: { code: true } });
      const n = normaliseCertificateCode(raw, country.code);
      if (!n.ok) throw new ValidationError(country.code === "PT" ? "The permanent certificate code has 12 digits: 0000-0000-0000." : "Enter the company registry number (3–40 letters or digits).");
      data.registryCertificateCode = n.code;
    }
  }
  if (!locked && input.vatNumber !== undefined) {
    const country = await prisma.country.findUniqueOrThrow({ where: { id: before.countryId } });
    const v = checkCompanyVat(input.vatNumber, country, before.taxId);
    if (!v.ok) throw new ValidationError(v.error);
    data.vatNumber = v.vat;
  }
  const after = await prisma.company.update({ where: { id: ctx.company.id }, data });
  await writeAudit({
    actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "company.profile_updated", entityType: "Company", entityId: ctx.company.id,
    before: { tradeName: before.tradeName, email: before.email, phone: before.phone, legalName: before.legalName, vatNumber: before.vatNumber, legalForm: before.legalForm, certificateCode: before.registryCertificateCode, activityCode: before.activityCode, activityCodes: before.activityCodes },
    after: { tradeName: after.tradeName, email: after.email, phone: after.phone, legalName: after.legalName, vatNumber: after.vatNumber, legalForm: after.legalForm, certificateCode: after.registryCertificateCode, activityCode: after.activityCode, activityCodes: after.activityCodes },
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

/**
 * Admin decision: approve / reject / request changes / suspend / reactivate / reopen.
 * `approveAnyway`: approve although waivable items (certificate code, POS invoice) are missing — the
 * reason is required and recorded on the company, in the status history and the audit log.
 */
export async function adminSetStatus(ctx: Ctx, companyId: string, to: AccountStatus, reason?: string | null, opts: { approveAnyway?: boolean } = {}) {
  const c = await loadForAdmin(ctx, companyId);
  if (!canDecideType(ctx, c.type)) throw new ForbiddenError();
  if (!ADMIN_TRANSITIONS[c.status].includes(to)) throw new AppError("BAD_TRANSITION", `Cannot change status from ${c.status} to ${to}.`);
  if (["REJECTED", "SUSPENDED"].includes(to) || (c.status === "UNDER_REVIEW" && to === "PENDING")) {
    if (!reason?.trim()) throw new ValidationError("Please give a reason — it is shown to the applicant.");
  }
  let waived: string[] = [];
  if (to === "APPROVED") {
    const missing = missingForApproval(await readinessInput(companyId));
    const hard = blocking(missing);
    if (hard.length) throw new ValidationError(`Cannot approve yet: ${hard.map(describeMissing).join("; ")}.`);
    const soft = waivable(missing);
    if (soft.length && !opts.approveAnyway) throw new ValidationError(`Cannot approve yet: ${soft.map(describeMissing).join("; ")}. Use "Approve anyway" with a note to approve without it.`);
    if (soft.length) {
      if ((reason?.trim().length ?? 0) < 10) throw new ValidationError("Say why you approve without it (at least 10 characters) — it is kept on the account.");
      waived = soft.map((m) => m.code);
    }
  }
  await transition(companyId, c.status, to, waived.length ? `Approved anyway (without ${waived.map((w) => describeMissing({ code: w }).toLowerCase()).join("; ")}): ${reason!.trim()}` : reason ?? null, ctx, waived.length ? { items: waived, note: reason!.trim() } : null);
}

async function transition(companyId: string, from: AccountStatus, to: AccountStatus, reason: string | null, ctx: Ctx, waiver: { items: string[]; note: string } | null = null) {
  await prisma.$transaction(async (tx) => {
    // Optimistic guard: only move if nobody changed the status in between.
    const res = await tx.company.updateMany({
      where: { id: companyId, status: from },
      data: {
        status: to,
        statusReason: ["REJECTED", "SUSPENDED", "PENDING"].includes(to) ? reason : null,
        ...(to === "APPROVED" ? { approvedAt: new Date(), approvedById: ctx.user.id } : {}),
        ...(waiver ? { approvalWaiver: { ...waiver, byUserId: ctx.user.id, at: new Date().toISOString() } } : {}),
      },
    });
    if (res.count !== 1) throw new AppError("CONFLICT", "The status was changed by someone else. Please reload.", 409);
    await tx.companyStatusHistory.create({ data: { companyId, fromStatus: from, toStatus: to, reason, byUserId: ctx.user.id } });
    if (to === "APPROVED") await applyBuyerDefaults(tx, companyId); // default payment terms / credit limit
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: waiver ? "company.status.approved_anyway" : `company.status.${to.toLowerCase()}`, entityType: "Company", entityId: companyId, before: { status: from }, after: { status: to, reason, ...(waiver ? { waived: waiver.items } : {}) } }, tx);
  });
  const notified: AccountStatus[] = ["UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED", "PENDING"];
  if (notified.includes(to)) await notify(`company.${to.toLowerCase()}`, [{ companyId, link: "/" }], { reason: waiver ? "" : reason ?? "" });
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
  // Changing an agreed commission needs a second person (the first rate, at approval, doesn't).
  const existing = await prisma.commissionRule.findFirst({ where: { vendorCompanyId, validTo: null, categoryId: null } });
  if (existing && Number(existing.rate) !== ratePercent) {
    const { approvalSettings, fourEyes } = await import("@/server/approvals/gate");
    const s = await approvalSettings();
    if (s.enabled && s.commissionChanges)
      await fourEyes(ctx, { kind: "COMMISSION", companyId: vendorCompanyId, summary: `${c.legalName}: commission ${Number(existing.rate)} % → ${ratePercent} %${note ? ` — ${note}` : ""}`, payload: { vendorCompanyId, ratePercent, note: note ?? null } });
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const current = await tx.commissionRule.findFirst({ where: { vendorCompanyId, validTo: null, categoryId: null } });
    if (current) await tx.commissionRule.update({ where: { id: current.id }, data: { validTo: now } });
    await tx.commissionRule.create({ data: { vendorCompanyId, type: "PERCENT", rate: ratePercent, validFrom: now, note: note ?? null, createdById: ctx.user.id } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "vendor.commission_set", entityType: "Company", entityId: vendorCompanyId, before: current ? { rate: current.rate.toString() } : null, after: { rate: ratePercent, note } }, tx);
  });
}

/**
 * FIRINGI corrects a company's registration details (a typo at sign-up, a change of legal form…). Users can't.
 * One company per NIF in a country and per VAT number; a Portuguese VAT number is PT + the NIF. Audited with the reason.
 */
export async function adminCorrectRegistration(ctx: Ctx, companyId: string, input: { legalName: string; taxId: string; vatNumber: string; legalForm: "COMPANY" | "SOLE_TRADER"; activityCode?: string | null; activityCodes?: string | null; reason: string }) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  const before = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: { country: true } });
  const { canDecideType } = await import("./admin-access");
  if (!canDecideType(ctx, before.type)) throw new ForbiddenError();
  if (input.reason.trim().length < 10) throw new ValidationError("Give the reason for the correction (at least 10 characters).");
  if (input.legalName.trim().length < 2) throw new ValidationError("Enter the legal name.");
  const { normaliseTaxId } = await import("./registration");
  const { isValidPtNif } = await import("@/lib/tax-id");
  const taxId = normaliseTaxId(before.country.code, input.taxId);
  if (before.country.code === "PT" && !isValidPtNif(taxId)) throw new ValidationError("Invalid Portuguese NIF.");
  if (taxId.length < 5) throw new ValidationError("Invalid tax ID.");
  const v = checkCompanyVat(input.vatNumber, before.country, taxId);
  if (!v.ok) throw new ValidationError(v.error);
  let activityCode = before.activityCode;
  if (input.activityCode !== undefined) {
    const { checkActivityCode } = await import("@/lib/activity-code");
    if (!input.activityCode?.trim()) activityCode = null;
    else { const a = checkActivityCode(input.activityCode, before.country.code); if (!a.ok) throw new ValidationError("Check the activity code's format for this country."); activityCode = a.value; }
  }
  let activityCodes = before.activityCodes;
  if (input.activityCodes !== undefined) {
    const { parseActivityCodes } = await import("@/lib/activity-code");
    const p = parseActivityCodes(input.activityCodes, before.country.code, activityCode);
    if (!p.ok) throw new ValidationError(`Check the secondary activity codes (${p.bad}).`);
    activityCodes = p.values;
  }
  const clash = await prisma.company.findFirst({ where: { id: { not: companyId }, OR: [{ countryId: before.countryId, taxId }, { vatNumber: v.vat }] }, select: { legalName: true } });
  if (clash) throw new ValidationError(`Another company already has this NIF / VAT number (${clash.legalName}) — one company, one NIF.`);
  const after = await prisma.company.update({ where: { id: companyId }, data: { legalName: input.legalName.trim(), taxId, vatNumber: v.vat, legalForm: input.legalForm, activityCode, activityCodes } });
  await writeAudit({
    actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "company.registration_corrected", entityType: "Company", entityId: companyId,
    before: { legalName: before.legalName, taxId: before.taxId, vatNumber: before.vatNumber, legalForm: before.legalForm, activityCode: before.activityCode, activityCodes: before.activityCodes },
    after: { legalName: after.legalName, taxId: after.taxId, vatNumber: after.vatNumber, legalForm: after.legalForm, activityCode: after.activityCode, activityCodes: after.activityCodes, reason: input.reason.trim() },
  });
  return { id: after.id };
}
