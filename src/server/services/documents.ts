/**
 * Company / driver / licence documents: upload by the owner, review by FIRINGI,
 * permission-checked download.
 */
import type { DocumentType, ReviewStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { REQUIRED_DOCUMENTS, OPTIONAL_DOCUMENTS, REQUIRED_DRIVER_DOCUMENTS } from "@/server/onboarding/rules";
import { canReviewDocsOf, canViewType, scopeWhere } from "./admin-access";
import { writeAudit } from "./audit";
import { readStored, storeUpload } from "./storage";
import { notifyCompany, notifyUser } from "./notify";

/** Document types a company may upload itself (licences go through the restricted-access flow). */
export function uploadableCompanyDocTypes(type: Exclude<Ctx["company"]["type"], "ADMIN">): DocumentType[] {
  return [...new Set([...REQUIRED_DOCUMENTS[type], ...OPTIONAL_DOCUMENTS])];
}

export async function uploadCompanyDocument(ctx: Ctx, input: { type: DocumentType; file: File; expiresAt?: Date | null }) {
  if (ctx.company.type === "ADMIN") throw new ForbiddenError();
  if (!can(ctx, "company.documents.manage")) throw new ForbiddenError();
  if (!uploadableCompanyDocTypes(ctx.company.type).includes(input.type)) throw new ValidationError("This document type can't be uploaded here.");
  const stored = await storeUpload(input.file, `companies/${ctx.company.id}`);
  const doc = await prisma.document.create({
    data: {
      companyId: ctx.company.id, type: input.type, fileKey: stored.key, fileName: stored.fileName, mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes, expiresAt: input.expiresAt ?? null, uploadedById: ctx.user.id,
    },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "document.uploaded", entityType: "Document", entityId: doc.id, after: { type: input.type, file: stored.fileName, sha256: stored.sha256 } });
  return doc;
}

/** A driver applicant uploads their own ID / driving licence. */
export async function uploadOwnDriverDocument(ctx: Ctx, input: { type: DocumentType; file: File; expiresAt?: Date | null }) {
  if (!ctx.driver) throw new ForbiddenError();
  if (!REQUIRED_DRIVER_DOCUMENTS.includes(input.type) && input.type !== "OTHER") throw new ValidationError("This document type can't be uploaded here.");
  const stored = await storeUpload(input.file, `drivers/${ctx.driver.id}`);
  const doc = await prisma.document.create({
    data: {
      driverId: ctx.driver.id, type: input.type, fileKey: stored.key, fileName: stored.fileName, mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes, expiresAt: input.expiresAt ?? null, uploadedById: ctx.user.id,
    },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "document.uploaded", entityType: "Document", entityId: doc.id, after: { type: input.type, driver: ctx.driver.id } });
  return doc;
}

/** Owner may withdraw a document that hasn't been approved yet. */
export async function deleteOwnDocument(ctx: Ctx, documentId: string) {
  const d = await prisma.document.findUnique({ where: { id: documentId } });
  const own = d && ((d.companyId === ctx.company.id && can(ctx, "company.documents.manage")) || (ctx.driver && d.driverId === ctx.driver.id));
  if (!d || !own) throw new NotFoundError("Document");
  if (d.status === "APPROVED") throw new ValidationError("Approved documents can't be removed. Upload a newer version instead.");
  await prisma.document.delete({ where: { id: documentId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "document.withdrawn", entityType: "Document", entityId: documentId, before: { type: d.type, file: d.fileName } });
}

/** Load a document if the caller may see it; used by the download route. */
export async function documentForDownload(ctx: Ctx, documentId: string) {
  const d = await prisma.document.findUnique({
    where: { id: documentId },
    include: { company: { select: { id: true, type: true } }, driver: { select: { id: true, ownerCompanyId: true } }, restrictionApproval: { select: { companyId: true, company: { select: { type: true } } } } },
  });
  if (!d) throw new NotFoundError("Document");
  const ownerCompanyId = d.companyId ?? d.restrictionApproval?.companyId ?? null;
  // 1. The company's own document managers (and the driver themselves).
  if (ownerCompanyId && ownerCompanyId === ctx.company.id && (can(ctx, "company.documents.manage") || can(ctx, "buyer.compliance.manage"))) return d;
  if (d.driverId && ctx.driver?.id === d.driverId) return d;
  // 2. FIRINGI staff allowed to view that account type (within their regional scope).
  if (ctx.company.type === "ADMIN") {
    if (d.driverId && can(ctx, ["admin.fleet.view", "admin.fleet.manage"])) return d;
    if (ownerCompanyId) {
      const type = d.company?.type ?? d.restrictionApproval?.company.type;
      if (type && canViewType(ctx, type) && (await prisma.company.count({ where: { id: ownerCompanyId, ...scopeWhere(ctx) } }))) return d;
    }
  }
  throw new NotFoundError("Document");
}

export async function readDocumentFile(ctx: Ctx, documentId: string) {
  const d = await documentForDownload(ctx, documentId);
  const data = await readStored(d.fileKey);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "document.downloaded", entityType: "Document", entityId: d.id });
  return { data, mimeType: d.mimeType, fileName: d.fileName };
}

/** FIRINGI reviews a document. Rejection requires a note (shown to the applicant). */
export async function reviewDocument(ctx: Ctx, documentId: string, decision: Extract<ReviewStatus, "APPROVED" | "REJECTED">, note?: string | null, expiresAt?: Date | null) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  const d = await prisma.document.findUnique({
    where: { id: documentId },
    include: { company: { select: { id: true, type: true } }, restrictionApproval: { select: { company: { select: { id: true, type: true } } } } },
  });
  if (!d) throw new NotFoundError("Document");
  const company = d.company ?? d.restrictionApproval?.company ?? null;
  const allowed = d.driverId ? can(ctx, "admin.fleet.manage") : company ? canReviewDocsOf(ctx, company.type) : false;
  if (!allowed) throw new ForbiddenError();
  if (company && !(await prisma.company.count({ where: { id: company.id, ...scopeWhere(ctx) } }))) throw new NotFoundError("Document");
  if (decision === "REJECTED" && !note?.trim()) throw new ValidationError("Please explain why the document is rejected.");
  if (d.status === decision) throw new AppError("NO_CHANGE", "The document already has this status.");
  await prisma.document.update({
    where: { id: documentId },
    data: { status: decision, reviewNote: note?.trim() || null, reviewedById: ctx.user.id, reviewedAt: new Date(), ...(expiresAt !== undefined ? { expiresAt } : {}) },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `document.${decision.toLowerCase()}`, entityType: "Document", entityId: documentId, before: { status: d.status }, after: { status: decision, note } });
  if (decision === "REJECTED") {
    const body = `Your document "${d.fileName}" (${d.type.replace(/_/g, " ").toLowerCase()}) was rejected: ${note}. Please upload a new version.`;
    if (company) await notifyCompany(company.id, { type: "document.rejected", title: "Document rejected", body, link: "/" });
    else if (d.driverId) {
      const drv = await prisma.driver.findUnique({ where: { id: d.driverId }, select: { userId: true } });
      if (drv) await notifyUser(drv.userId, { type: "document.rejected", title: "Document rejected", body, link: "/" });
    }
  }
}
