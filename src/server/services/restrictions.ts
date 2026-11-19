/**
 * Tobacco / alcohol access. A buyer must hold an APPROVED, non-expired approval for a
 * restriction before it may see or buy products carrying it (enforced in the catalogue
 * visibility layer from Phase 3 through `allowedRestrictions`).
 */
import type { Restriction } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { scopeWhere } from "./admin-access";
import { writeAudit } from "./audit";
import { storeUpload } from "./storage";
import { notify } from "@/server/notify/dispatch";

const LICENCE_DOC = { TOBACCO: "TOBACCO_LICENCE", ALCOHOL: "ALCOHOL_LICENCE" } as const;

/** Restrictions the company is currently cleared for. */
export async function allowedRestrictions(companyId: string, now = new Date()): Promise<Restriction[]> {
  const rows = await prisma.restrictionApproval.findMany({
    where: { companyId, status: "APPROVED", OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
    select: { restriction: true },
  });
  const out = new Set<Restriction>(rows.map((r) => r.restriction));
  // Phase 43: a licence approved under Company › Licences opens the same categories; where FIRINGI doesn't ask
  // for a licence (or only warns), the products stay visible and the checkout decides.
  const { licenceAccess } = await import("@/server/excise/service");
  for (const r of await licenceAccess(companyId, now)) out.add(r);
  return (["TOBACCO", "ALCOHOL"] as Restriction[]).filter((r) => out.has(r));
}

export async function listOwnRestrictionApprovals(ctx: Ctx) {
  if (!can(ctx, "buyer.compliance.manage")) throw new ForbiddenError();
  return prisma.restrictionApproval.findMany({
    where: { companyId: ctx.company.id },
    include: { documents: { select: { id: true, fileName: true, status: true, createdAt: true } } },
  });
}

/** Buyer applies (or re-applies) for access, with licence number and licence document. */
export async function requestRestrictionAccess(
  ctx: Ctx,
  input: { restriction: Restriction; licenceNumber: string; issuingAuthority: string; validUntil?: Date | null; file: File },
) {
  if (!can(ctx, "buyer.compliance.manage")) throw new ForbiddenError();
  if (!["CUSTOMER", "WHOLESALER"].includes(ctx.company.type)) throw new ForbiddenError();
  const existing = await prisma.restrictionApproval.findUnique({ where: { companyId_restriction: { companyId: ctx.company.id, restriction: input.restriction } } });
  if (existing?.status === "PENDING") throw new AppError("ALREADY_PENDING", "A request for this category is already waiting for review.");
  if (existing?.status === "APPROVED" && (!existing.validUntil || existing.validUntil > new Date()))
    throw new AppError("ALREADY_APPROVED", "You already have access to this category.");
  const stored = await storeUpload(input.file, `companies/${ctx.company.id}/licences`);
  const extraInfo = { licenceNumber: input.licenceNumber.trim(), issuingAuthority: input.issuingAuthority.trim(), requestedValidUntil: input.validUntil?.toISOString() ?? null };
  const approval = await prisma.$transaction(async (tx) => {
    const a = existing
      ? await tx.restrictionApproval.update({ where: { id: existing.id }, data: { status: "PENDING", extraInfo, reviewNote: null, reviewedAt: null, reviewedById: null, validUntil: null } })
      : await tx.restrictionApproval.create({ data: { companyId: ctx.company.id, restriction: input.restriction, extraInfo } });
    await tx.document.create({
      data: {
        companyId: ctx.company.id, restrictionApprovalId: a.id, type: LICENCE_DOC[input.restriction], fileKey: stored.key, fileName: stored.fileName,
        mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, expiresAt: input.validUntil ?? null, uploadedById: ctx.user.id,
      },
    });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "restriction.requested", entityType: "RestrictionApproval", entityId: a.id, after: { restriction: input.restriction, ...extraInfo } }, tx);
    return a;
  });
  return approval;
}

export async function reviewRestrictionAccess(
  ctx: Ctx, approvalId: string, decision: "APPROVED" | "REJECTED" | "REVOKED", input: { note?: string | null; validUntil?: Date | null },
) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.customers.approve", "admin.risk.manage"])) throw new ForbiddenError();
  const a = await prisma.restrictionApproval.findFirst({ where: { id: approvalId, company: scopeWhere(ctx) }, include: { documents: true } });
  if (!a) throw new NotFoundError("Request");
  const from = a.status;
  const ok = (decision === "REVOKED" && from === "APPROVED") || (decision !== "REVOKED" && from === "PENDING");
  if (!ok) throw new AppError("BAD_TRANSITION", `Cannot change from ${from} to ${decision}.`);
  if (decision !== "APPROVED" && !input.note?.trim()) throw new ValidationError("Please give a reason.");
  if (decision === "APPROVED") {
    if (!input.validUntil || input.validUntil <= new Date()) throw new ValidationError("Set the date until which the licence is valid.");
    if (a.documents.length === 0) throw new ValidationError("No licence document was uploaded.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.restrictionApproval.update({
      where: { id: a.id },
      data: { status: decision, reviewNote: input.note?.trim() || null, reviewedById: ctx.user.id, reviewedAt: new Date(), validUntil: decision === "APPROVED" ? input.validUntil : a.validUntil },
    });
    if (decision !== "REVOKED")
      await tx.document.updateMany({ where: { restrictionApprovalId: a.id, status: "PENDING" }, data: { status: decision, reviewedById: ctx.user.id, reviewedAt: new Date(), reviewNote: input.note ?? null } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `restriction.${decision.toLowerCase()}`, entityType: "RestrictionApproval", entityId: a.id, before: { status: from }, after: { status: decision, validUntil: input.validUntil, note: input.note } }, tx);
  });
  await notify(`restriction.${decision.toLowerCase()}`, [{ companyId: a.companyId, link: "/" }], { restriction: a.restriction, until: input.validUntil?.toISOString().slice(0, 10) ?? "", reason: input.note });
}
