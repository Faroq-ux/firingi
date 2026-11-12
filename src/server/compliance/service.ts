/**
 * Supplier compliance (Phase 28): certificate types (FIRINGI), certificates (suppliers upload,
 * FIRINGI reviews), grace waivers, automatic pausing of offers, re-checks, the daily job and the
 * verified badges customers see. The rules live in ./rules.ts.
 */
import type { CompanyType, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import type { PermissionCode } from "@/server/rbac/permissions";
import { writeAudit } from "@/server/services/audit";
import { readStored, storeUpload } from "@/server/services/storage";
import { scopeWhere } from "@/server/services/admin-access";
import { notify } from "@/server/notify/dispatch";
import { applies, COVERED, dayOf, daysBetween, evaluate, pausePlan, reminderDue, score, type CertLite, type CertState, type Evaluation, type TypeRule } from "./rules";

const VENDOR_TYPES: CompanyType[] = ["DISTRIBUTOR", "WHOLESALER"];
const ADMIN_VIEW: PermissionCode[] = ["admin.vendors.view", "admin.vendors.approve", "admin.risk.view", "admin.risk.manage"];
const ADMIN_MANAGE: PermissionCode[] = ["admin.vendors.approve", "admin.risk.manage"];
const SUPPLIER_VIEW: PermissionCode[] = ["company.documents.manage", "company.profile.manage", "vendor.products.view", "vendor.products.manage"];
const DAY = 86_400_000;

export const canViewCompliance = (ctx: Ctx) => ctx.company.type === "ADMIN" && can(ctx, ADMIN_VIEW);
export const canManageCompliance = (ctx: Ctx) => ctx.company.type === "ADMIN" && can(ctx, ADMIN_MANAGE);
function requireView(ctx: Ctx) { if (!canViewCompliance(ctx)) throw new ForbiddenError(); }
function requireManage(ctx: Ctx) { if (!canManageCompliance(ctx)) throw new ForbiddenError(); }
function requireSupplier(ctx: Ctx, perm: PermissionCode | PermissionCode[] = SUPPLIER_VIEW) {
  if (!VENDOR_TYPES.includes(ctx.company.type) || !can(ctx, perm)) throw new ForbiddenError();
}
const firingiId = async () => (await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" }, select: { id: true } })).id;
const today = () => dayOf(new Date());
const parseDay = (s: string | null | undefined) => {
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new ValidationError("Invalid date.");
  return d;
};
const addMonths = (d: Date, m: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, d.getUTCDate()));

const certLite = { id: true, typeId: true, status: true, expiresOn: true, reviewedAt: true, createdAt: true, supersededAt: true } as const;

async function activeTypes() {
  return prisma.certificateType.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}
type TypeRow = Awaited<ReturnType<typeof activeTypes>>[number];

/** Everything about one supplier: per applicable type its state, plus score and pause. */
async function stateOf(companyId: string, types?: TypeRow[], at = new Date()) {
  const [company, allTypes, certs, waivers] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { id: true, type: true, countryId: true, compliancePausedAt: true, compliancePauseReason: true } }),
    types ? Promise.resolve(types) : activeTypes(),
    prisma.certificate.findMany({ where: { companyId }, select: certLite }),
    prisma.complianceWaiver.findMany({ where: { companyId, revokedAt: null } }),
  ]);
  const rows = allTypes.filter((t) => applies(t as TypeRule, company)).map((t) => ({ type: t, ...evaluate(t, certs as CertLite[], waivers, at) }));
  return { company, rows, score: score(rows.map((r) => ({ required: r.type.required, state: r.state }))) };
}

// ── pausing ─────────────────────────────────────────────────────────────────

async function offersInCategories(companyId: string, categoryIds: string[]) {
  if (!categoryIds.length) return [];
  const like = categoryIds.map((id) => `%/${id}/%`);
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT vo.id FROM "VendorOffer" vo
    JOIN "PackagingUnit" pp ON pp.id = vo."packagingUnitId" JOIN "ProductVariant" pv ON pv.id = pp."variantId"
    JOIN "Product" p ON p.id = pv."productId" JOIN "Category" c ON c.id = p."categoryId"
    WHERE vo."vendorCompanyId" = ${companyId} AND c.path LIKE ANY (${like}::text[])`;
  return rows.map((r) => r.id);
}

/**
 * Re-apply the pause rules to one supplier: pause / un-pause the supplier (whole-supplier types)
 * and the offers in the categories of category types. Tells the supplier when it becomes paused
 * or is fully resumed. Returns what changed.
 */
export async function recomputeCompany(companyId: string, types?: TypeRow[], at = new Date()) {
  const s = await stateOf(companyId, types, at);
  if (!VENDOR_TYPES.includes(s.company.type)) return { paused: false, changed: false };
  const plan = pausePlan(s.rows.map((r) => ({ type: r.type, state: r.state })));
  const offerReasons = new Map<string, string[]>();
  for (const c of plan.byCategory) for (const id of await offersInCategories(companyId, c.categoryIds)) offerReasons.set(id, [...(offerReasons.get(id) ?? []), c.key]);
  const pausedBefore = await prisma.vendorOffer.findMany({ where: { vendorCompanyId: companyId, compliancePausedAt: { not: null } }, select: { id: true, compliancePauseReason: true } });
  const wasPaused = !!s.company.compliancePausedAt || pausedBefore.length > 0;
  const now = new Date();
  const wholeReason = plan.whole.join(",") || null;
  await prisma.$transaction(async (tx) => {
    if (wholeReason !== s.company.compliancePauseReason || !!wholeReason !== !!s.company.compliancePausedAt)
      await tx.company.update({ where: { id: companyId }, data: { compliancePausedAt: wholeReason ? s.company.compliancePausedAt ?? now : null, compliancePauseReason: wholeReason } });
    const resume = pausedBefore.filter((o) => !offerReasons.has(o.id)).map((o) => o.id);
    if (resume.length) await tx.vendorOffer.updateMany({ where: { id: { in: resume } }, data: { compliancePausedAt: null, compliancePauseReason: null } });
    const before = new Map(pausedBefore.map((o) => [o.id, o.compliancePauseReason]));
    const byReason = new Map<string, string[]>();
    for (const [id, keys] of offerReasons) {
      const r = [...new Set(keys)].join(",");
      if (before.get(id) === r) continue;
      byReason.set(r, [...(byReason.get(r) ?? []), id]);
    }
    for (const [r, ids] of byReason) {
      await tx.vendorOffer.updateMany({ where: { id: { in: ids }, compliancePausedAt: null }, data: { compliancePausedAt: now, compliancePauseReason: r } });
      await tx.vendorOffer.updateMany({ where: { id: { in: ids }, compliancePausedAt: { not: null } }, data: { compliancePauseReason: r } });
    }
  });
  const isPaused = !!wholeReason || offerReasons.size > 0;
  if (isPaused !== wasPaused) {
    const failing = s.rows.filter((r) => r.type.required && !COVERED.includes(r.state)).map((r) => r.type.name);
    const offers = wholeReason ? await prisma.vendorOffer.count({ where: { vendorCompanyId: companyId, status: "ACTIVE" } }) : offerReasons.size;
    await writeAudit({ actorUserId: null, actorCompanyId: null, action: isPaused ? "compliance.paused" : "compliance.resumed", entityType: "Company", entityId: companyId, after: { whole: plan.whole, categoryTypes: plan.byCategory.map((c) => c.key), offers } });
    await notify(isPaused ? "compliance.paused" : "compliance.resumed", [{ companyId, link: "/vendor/company/compliance" }], isPaused ? { certificates: failing.join(", "), offers } : {}).catch(() => null);
  }
  return { paused: isPaused, changed: isPaused !== wasPaused, whole: plan.whole, offers: offerReasons.size };
}

/** All suppliers (after a certificate type changes, and daily). */
export async function recomputeAll(at = new Date()) {
  const types = await activeTypes();
  const ids = await prisma.company.findMany({ where: { type: { in: VENDOR_TYPES } }, select: { id: true } });
  let paused = 0, changed = 0;
  for (const { id } of ids) {
    const r = await recomputeCompany(id, types, at);
    if (r.paused) paused++;
    if (r.changed) changed++;
  }
  return { suppliers: ids.length, paused, changed };
}

/** Daily job: expire certificates, remind suppliers 30 / 14 / 7 days ahead, tell FIRINGI about re-checks, re-apply pauses. */
export async function runComplianceJob(at = new Date()) {
  const now = dayOf(at);
  const expiring = await prisma.certificate.findMany({
    where: { status: "APPROVED", supersededAt: null, expiresOn: { not: null, lte: new Date(now.getTime() + 30 * DAY) }, type: { hasExpiry: true } },
    include: { type: { select: { name: true, graceDays: true } } },
  });
  let expired = 0, reminders = 0;
  for (const c of expiring) {
    const left = daysBetween(now, c.expiresOn!);
    if (left < 0) {
      const r = await prisma.certificate.updateMany({ where: { id: c.id, status: "APPROVED" }, data: { status: "EXPIRED" } });
      if (r.count) {
        expired++;
        await writeAudit({ actorUserId: null, actorCompanyId: null, action: "compliance.certificate_expired", entityType: "Certificate", entityId: c.id, after: { expiresOn: c.expiresOn, graceDays: c.type.graceDays } });
        await notify("compliance.expired", [{ companyId: c.companyId, link: "/vendor/company/compliance" }], { certificate: c.type.name, grace: c.type.graceDays }, { ref: { type: "Certificate", id: c.id } }).catch(() => null);
      }
      continue;
    }
    const due = reminderDue(left, c.remindedDays);
    if (!due) continue;
    await prisma.certificate.update({ where: { id: c.id }, data: { remindedDays: [...c.remindedDays, ...due.mark] } });
    reminders++;
    await notify("compliance.expiring", [{ companyId: c.companyId, link: "/vendor/company/compliance" }], { certificate: c.type.name, days: left, date: c.expiresOn!.toISOString().slice(0, 10) }, { ref: { type: "Certificate", id: c.id } }).catch(() => null);
  }
  const rechecks = await prisma.certificate.count({ where: { status: "APPROVED", supersededAt: null, recheckDueOn: { lte: now } } });
  if (rechecks) await notify("compliance.recheck", [{ companyId: await firingiId(), link: "/admin/vendors/compliance/overview" }], { count: rechecks }).catch(() => null);
  const r = await recomputeAll(at);
  return { expired, reminders, rechecks, ...r };
}

// ── supplier side ───────────────────────────────────────────────────────────

const typeView = (t: TypeRow) => ({
  id: t.id, key: t.key, name: t.name, description: t.description, required: t.required, needsNumber: t.needsNumber, hasExpiry: t.hasExpiry,
  graceDays: t.graceDays, badgeEnabled: t.badgeEnabled, publicDownload: t.publicDownload, categoryIds: t.categoryIds, recheckMonths: t.recheckMonths,
});
const certView = (c: { id: string; typeId: string; number: string | null; issuer: string | null; issuedOn: Date | null; expiresOn: Date | null; fileName: string; status: string; reviewNote: string | null; reviewedAt: Date | null; recheckDueOn: Date | null; lastCheckAt: Date | null; badgeHidden: boolean; supersededAt: Date | null; createdAt: Date }) => ({
  id: c.id, typeId: c.typeId, number: c.number, issuer: c.issuer, issuedOn: c.issuedOn, expiresOn: c.expiresOn, fileName: c.fileName, status: c.status,
  reviewNote: c.reviewNote, reviewedAt: c.reviewedAt, recheckDueOn: c.recheckDueOn, lastCheckAt: c.lastCheckAt, badgeHidden: c.badgeHidden, supersededAt: c.supersededAt, createdAt: c.createdAt,
});
const evalView = (e: Evaluation) => ({ state: e.state, currentId: e.current?.id ?? null, pendingId: e.pending?.id ?? null, daysLeft: e.daysLeft, graceUntil: e.graceUntil, waiverUntil: e.waiverUntil });

async function complianceOf(companyId: string) {
  const [s, certs, pausedOffers, activeOffers, cats] = await Promise.all([
    stateOf(companyId),
    prisma.certificate.findMany({ where: { companyId }, include: { type: { select: { key: true, name: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.vendorOffer.count({ where: { vendorCompanyId: companyId, compliancePausedAt: { not: null } } }),
    prisma.vendorOffer.count({ where: { vendorCompanyId: companyId, status: "ACTIVE" } }),
    prisma.category.findMany({ select: { id: true, name: true } }),
  ]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  return {
    score: s.score,
    pausedWhole: s.company.compliancePausedAt, pauseReason: s.company.compliancePauseReason?.split(",").filter(Boolean) ?? [],
    pausedOffers: s.company.compliancePausedAt ? activeOffers : pausedOffers, activeOffers,
    rows: s.rows.map((r) => ({ type: { ...typeView(r.type), categories: r.type.categoryIds.map((id) => catName.get(id) ?? null).filter(Boolean) as Prisma.JsonValue[] }, ...evalView(r) })),
    history: certs.map((c) => ({ ...certView(c), typeKey: c.type.key, typeName: c.type.name })),
    badges: s.rows.filter((r) => r.type.badgeEnabled && (r.state === "VALID" || r.state === "EXPIRING") && r.current).map((r) => {
      const c = certs.find((x) => x.id === r.current!.id)!;
      return { key: r.type.key, name: r.type.name, hidden: c.badgeHidden };
    }),
  };
}

/** The supplier's own compliance page. */
export async function myCompliance(ctx: Ctx) {
  requireSupplier(ctx);
  return complianceOf(ctx.company.id);
}

export type CertificateInput = { typeId: string; number?: string | null; issuer?: string | null; issuedOn?: string | null; expiresOn?: string | null; file: File };

export async function uploadCertificate(ctx: Ctx, i: CertificateInput) {
  requireSupplier(ctx, "company.documents.manage");
  const type = await prisma.certificateType.findFirst({ where: { id: i.typeId, isActive: true } });
  const co = await prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { type: true, countryId: true } });
  if (!type || !applies(type as TypeRule, co)) throw new ValidationError("This certificate isn't asked for your company.");
  const number = i.number?.trim() || null, issuer = i.issuer?.trim() || null;
  if (type.needsNumber && !number) throw new ValidationError("Enter the certificate number.");
  if ((number?.length ?? 0) > 80 || (issuer?.length ?? 0) > 120) throw new ValidationError("Certificate number or issuer is too long.");
  const issuedOn = parseDay(i.issuedOn), expiresOn = parseDay(i.expiresOn);
  const t0 = today();
  if (issuedOn && issuedOn > t0) throw new ValidationError("The issue date can't be in the future.");
  if (type.hasExpiry && !expiresOn) throw new ValidationError("Enter the expiry date.");
  if (expiresOn && expiresOn < t0) throw new ValidationError("This certificate has already expired — upload the current one.");
  if (issuedOn && expiresOn && expiresOn < issuedOn) throw new ValidationError("The expiry date is before the issue date.");
  const stored = await storeUpload(i.file, `compliance/${ctx.company.id}`);
  const c = await prisma.certificate.create({
    data: {
      companyId: ctx.company.id, typeId: type.id, number, issuer, issuedOn, expiresOn: type.hasExpiry ? expiresOn : null,
      fileKey: stored.key, fileName: stored.fileName, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, uploadedById: ctx.user.id,
    },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "compliance.certificate_uploaded", entityType: "Certificate", entityId: c.id, after: { type: type.key, number, expiresOn, file: stored.fileName, sha256: stored.sha256 } });
  await notify("compliance.review", [{ companyId: await firingiId(), link: `/admin/vendors/compliance/certificates/${c.id}` }], { company: ctx.company.tradeName ?? ctx.company.legalName, certificate: type.name }, { ref: { type: "Certificate", id: c.id } }).catch(() => null);
  await recomputeCompany(ctx.company.id); // a pending upload doesn't un-pause, but keeps the state fresh
  return c.id;
}

/** A supplier withdraws an upload FIRINGI hasn't reviewed yet. */
export async function withdrawCertificate(ctx: Ctx, id: string) {
  requireSupplier(ctx, "company.documents.manage");
  const r = await prisma.certificate.deleteMany({ where: { id, companyId: ctx.company.id, status: "PENDING" } });
  if (!r.count) throw new NotFoundError("Certificate");
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "compliance.certificate_withdrawn", entityType: "Certificate", entityId: id });
}

// ── FIRINGI: review ─────────────────────────────────────────────────────────

async function loadCert(ctx: Ctx, id: string) {
  const c = await prisma.certificate.findFirst({ where: { id, company: scopeWhere(ctx) }, include: { type: true, company: { select: { id: true, legalName: true, tradeName: true, type: true } } } });
  if (!c) throw new NotFoundError("Certificate");
  return c;
}

export async function reviewQueue(ctx: Ctx) {
  requireView(ctx);
  return prisma.certificate.findMany({
    where: { status: "PENDING", company: scopeWhere(ctx) },
    include: { type: { select: { key: true, name: true, required: true } }, company: { select: { id: true, legalName: true, tradeName: true, type: true, country: { select: { flag: true } } } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function certificateDetail(ctx: Ctx, id: string) {
  requireView(ctx);
  const c = await loadCert(ctx, id);
  const [history, audit, waivers] = await Promise.all([
    prisma.certificate.findMany({ where: { companyId: c.companyId, typeId: c.typeId }, orderBy: { createdAt: "desc" } }),
    withActors(prisma.auditLog.findMany({ where: { entityType: "Certificate", entityId: id }, orderBy: { at: "desc" }, take: 50 })),
    prisma.complianceWaiver.findMany({ where: { companyId: c.companyId, typeId: c.typeId }, orderBy: { createdAt: "desc" } }),
  ]);
  return { cert: c, history, audit, waivers, canManage: canManageCompliance(ctx) };
}

export type ApproveInput = { expiresOn?: string | null; number?: string | null; recheckDueOn?: string | null; note?: string | null };

/** Approve: the certificate replaces the earlier one of its type; expiry / number can be corrected from the file. */
export async function approveCertificate(ctx: Ctx, id: string, i: ApproveInput = {}) {
  requireManage(ctx);
  const c = await loadCert(ctx, id);
  if (c.status !== "PENDING" && c.status !== "REJECTED") throw new AppError("BAD_STATUS", "Only certificates waiting for review can be approved.");
  const expiresOn = i.expiresOn !== undefined ? parseDay(i.expiresOn) : c.expiresOn;
  if (c.type.hasExpiry && !expiresOn) throw new ValidationError("Enter the expiry date shown on the certificate.");
  if (expiresOn && expiresOn < today()) throw new ValidationError("The certificate has expired — reject it and ask for the current one.");
  const number = i.number !== undefined ? i.number?.trim() || null : c.number;
  if (c.type.needsNumber && !number) throw new ValidationError("Enter the certificate number.");
  const recheckDueOn = i.recheckDueOn ? parseDay(i.recheckDueOn) : c.type.recheckMonths ? addMonths(today(), c.type.recheckMonths) : null;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.certificate.updateMany({ where: { companyId: c.companyId, typeId: c.typeId, id: { not: id }, supersededAt: null, status: { in: ["APPROVED", "EXPIRED"] } }, data: { supersededAt: now } });
    await tx.certificate.update({ where: { id }, data: { status: "APPROVED", reviewedById: ctx.user.id, reviewedAt: now, reviewNote: i.note?.trim() || null, expiresOn: c.type.hasExpiry ? expiresOn : null, number, recheckDueOn, lastCheckAt: now, remindedDays: [] } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "compliance.certificate_approved", entityType: "Certificate", entityId: id, before: { status: c.status, expiresOn: c.expiresOn, number: c.number }, after: { status: "APPROVED", expiresOn, number, recheckDueOn, note: i.note ?? null } }, tx);
  });
  await notify("compliance.approved", [{ companyId: c.companyId, link: "/vendor/company/compliance" }], { certificate: c.type.name }, { ref: { type: "Certificate", id } }).catch(() => null);
  return recomputeCompany(c.companyId);
}

export async function rejectCertificate(ctx: Ctx, id: string, note: string) {
  requireManage(ctx);
  const c = await loadCert(ctx, id);
  if (c.status !== "PENDING") throw new AppError("BAD_STATUS", "Only certificates waiting for review can be rejected.");
  if (!note?.trim()) throw new ValidationError("Say why — the supplier sees it.");
  await prisma.certificate.update({ where: { id }, data: { status: "REJECTED", reviewedById: ctx.user.id, reviewedAt: new Date(), reviewNote: note.trim() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "compliance.certificate_rejected", entityType: "Certificate", entityId: id, after: { note } });
  await notify("compliance.rejected", [{ companyId: c.companyId, link: "/vendor/company/compliance" }], { certificate: c.type.name, reason: note.trim() }, { ref: { type: "Certificate", id } }).catch(() => null);
  return recomputeCompany(c.companyId);
}

/** Withdraw FIRINGI's approval (e.g. the certificate was suspended by the issuer). */
export async function revokeCertificate(ctx: Ctx, id: string, note: string) {
  requireManage(ctx);
  const c = await loadCert(ctx, id);
  if (c.status !== "APPROVED" && c.status !== "EXPIRED") throw new AppError("BAD_STATUS", "Only approved certificates can be revoked.");
  if ((note?.trim().length ?? 0) < 5) throw new ValidationError("Say why — the supplier sees it.");
  await prisma.certificate.update({ where: { id }, data: { status: "REVOKED", reviewedById: ctx.user.id, reviewedAt: new Date(), reviewNote: note.trim() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "compliance.certificate_revoked", entityType: "Certificate", entityId: id, before: { status: c.status }, after: { note } });
  await notify("compliance.rejected", [{ companyId: c.companyId, link: "/vendor/company/compliance" }], { certificate: c.type.name, reason: note.trim() }, { ref: { type: "Certificate", id } }).catch(() => null);
  return recomputeCompany(c.companyId);
}

/** Hide (or show again) this supplier's badge for this certificate. */
export async function setBadgeHidden(ctx: Ctx, id: string, hidden: boolean) {
  requireManage(ctx);
  const c = await loadCert(ctx, id);
  await prisma.certificate.update({ where: { id }, data: { badgeHidden: hidden } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: hidden ? "compliance.badge_hidden" : "compliance.badge_shown", entityType: "Certificate", entityId: id, after: { company: c.companyId, type: c.type.key } });
}

/** FIRINGI re-checked the certificate (e.g. looked it up with the issuer): next re-check in N months. */
export async function markRechecked(ctx: Ctx, id: string, note?: string | null) {
  requireManage(ctx);
  const c = await loadCert(ctx, id);
  if (c.status !== "APPROVED") throw new AppError("BAD_STATUS", "Only approved certificates are re-checked.");
  const next = c.type.recheckMonths ? addMonths(today(), c.type.recheckMonths) : null;
  await prisma.certificate.update({ where: { id }, data: { lastCheckAt: new Date(), recheckDueOn: next } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "compliance.certificate_rechecked", entityType: "Certificate", entityId: id, after: { next, note: note ?? null } });
}

// ── FIRINGI: waivers ────────────────────────────────────────────────────────

export async function grantWaiver(ctx: Ctx, companyId: string, typeId: string, until: string, reason: string) {
  requireManage(ctx);
  const co = await prisma.company.findFirst({ where: { id: companyId, type: { in: VENDOR_TYPES }, ...scopeWhere(ctx) }, select: { id: true } });
  if (!co) throw new NotFoundError("Supplier");
  const type = await prisma.certificateType.findUnique({ where: { id: typeId } });
  if (!type) throw new NotFoundError("Certificate type");
  const d = parseDay(until)!;
  if (!d || d < today()) throw new ValidationError("The grace period must end today or later.");
  if (d.getTime() > today().getTime() + 366 * DAY) throw new ValidationError("Grace periods are at most one year.");
  if ((reason?.trim().length ?? 0) < 10) throw new ValidationError("Say why (at least 10 characters).");
  await prisma.complianceWaiver.updateMany({ where: { companyId, typeId, revokedAt: null }, data: { revokedAt: new Date() } });
  const w = await prisma.complianceWaiver.create({ data: { companyId, typeId, until: d, reason: reason.trim(), createdById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "compliance.waiver_granted", entityType: "Company", entityId: companyId, after: { type: type.key, until: d, reason } });
  await recomputeCompany(companyId);
  return w.id;
}

export async function revokeWaiver(ctx: Ctx, waiverId: string) {
  requireManage(ctx);
  const w = await prisma.complianceWaiver.findFirst({ where: { id: waiverId, revokedAt: null, company: scopeWhere(ctx) }, include: { type: { select: { key: true } } } });
  if (!w) throw new NotFoundError("Waiver");
  await prisma.complianceWaiver.update({ where: { id: waiverId }, data: { revokedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "compliance.waiver_revoked", entityType: "Company", entityId: w.companyId, after: { type: w.type.key } });
  await recomputeCompany(w.companyId);
}

// ── FIRINGI: certificate types ──────────────────────────────────────────────

export type TypeInput = {
  name: string; description?: string | null; appliesTo: ("DISTRIBUTOR" | "WHOLESALER")[]; countryIds: string[]; categoryIds: string[];
  required: boolean; needsNumber: boolean; hasExpiry: boolean; recheckMonths: number | null; graceDays: number;
  badgeEnabled: boolean; publicDownload: boolean; isActive: boolean; sortOrder?: number;
};

/** Types with how many suppliers each applies to and how many are covered. */
export async function listTypes(ctx: Ctx) {
  requireView(ctx);
  const [types, vendors, certs, waivers] = await Promise.all([
    prisma.certificateType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.company.findMany({ where: { type: { in: VENDOR_TYPES }, status: "APPROVED" }, select: { id: true, type: true, countryId: true } }),
    prisma.certificate.findMany({ select: { ...certLite, companyId: true } }),
    prisma.complianceWaiver.findMany({ where: { revokedAt: null } }),
  ]);
  return types.map((t) => {
    const scope = vendors.filter((v) => applies({ ...t, isActive: true } as TypeRule, v));
    const covered = scope.filter((v) => COVERED.includes(evaluate(t, certs.filter((c) => c.companyId === v.id) as CertLite[], waivers.filter((w) => w.companyId === v.id)).state)).length;
    return { ...t, suppliers: scope.length, covered };
  });
}

export async function saveType(ctx: Ctx, id: string | null, i: TypeInput) {
  requireManage(ctx);
  const name = i.name.trim();
  if (name.length < 2 || name.length > 80) throw new ValidationError("Give the certificate a name (2–80 characters).");
  if (!i.appliesTo.length) throw new ValidationError("Choose who it applies to.");
  if (i.recheckMonths !== null && !(i.recheckMonths >= 1 && i.recheckMonths <= 60)) throw new ValidationError("Re-check every 1–60 months.");
  if (!(i.graceDays >= 0 && i.graceDays <= 365)) throw new ValidationError("Grace period: 0–365 days.");
  if (i.categoryIds.length && (await prisma.category.count({ where: { id: { in: i.categoryIds } } })) !== i.categoryIds.length) throw new ValidationError("Unknown category.");
  if (i.countryIds.length && (await prisma.country.count({ where: { id: { in: i.countryIds } } })) !== i.countryIds.length) throw new ValidationError("Unknown country.");
  const data = {
    name, description: i.description?.trim() || null, appliesTo: i.appliesTo, countryIds: i.countryIds, categoryIds: i.categoryIds, required: i.required,
    needsNumber: i.needsNumber, hasExpiry: i.hasExpiry, recheckMonths: i.recheckMonths, graceDays: i.graceDays, badgeEnabled: i.badgeEnabled,
    publicDownload: i.publicDownload, isActive: i.isActive, ...(i.sortOrder !== undefined ? { sortOrder: i.sortOrder } : {}),
  };
  let row;
  if (id) {
    const before = await prisma.certificateType.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Certificate type");
    row = await prisma.certificateType.update({ where: { id }, data });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "compliance.type_updated", entityType: "CertificateType", entityId: id, before, after: data });
  } else {
    let key = name.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s-]+/g, "_").toUpperCase().slice(0, 40) || "CERT";
    if (await prisma.certificateType.count({ where: { key } })) key = `${key}_${Date.now().toString(36).toUpperCase()}`;
    const max = await prisma.certificateType.aggregate({ _max: { sortOrder: true } });
    row = await prisma.certificateType.create({ data: { ...data, key, sortOrder: i.sortOrder ?? (max._max.sortOrder ?? 0) + 10 } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "compliance.type_created", entityType: "CertificateType", entityId: row.id, after: { key, ...data } });
  }
  const impact = await recomputeAll();
  return { id: row.id, impact };
}

/** Badge on / off for a certificate type (quick switch). */
export async function setTypeBadge(ctx: Ctx, id: string, enabled: boolean) {
  requireManage(ctx);
  const t = await prisma.certificateType.update({ where: { id }, data: { badgeEnabled: enabled } }).catch(() => null);
  if (!t) throw new NotFoundError("Certificate type");
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: enabled ? "compliance.type_badge_on" : "compliance.type_badge_off", entityType: "CertificateType", entityId: id, after: { key: t.key } });
}

// ── FIRINGI: dashboards ─────────────────────────────────────────────────────

/** One row per supplier: score, what's missing, pause. */
export async function supplierList(ctx: Ctx) {
  requireView(ctx);
  const [types, vendors, certs, waivers, paused] = await Promise.all([
    activeTypes(),
    prisma.company.findMany({ where: { type: { in: VENDOR_TYPES }, status: { in: ["APPROVED", "SUSPENDED", "UNDER_REVIEW"] }, ...scopeWhere(ctx) }, select: { id: true, legalName: true, tradeName: true, type: true, status: true, countryId: true, compliancePausedAt: true, country: { select: { flag: true, code: true } } }, orderBy: { legalName: "asc" } }),
    prisma.certificate.findMany({ select: { ...certLite, companyId: true } }),
    prisma.complianceWaiver.findMany({ where: { revokedAt: null } }),
    prisma.vendorOffer.groupBy({ by: ["vendorCompanyId"], where: { compliancePausedAt: { not: null } }, _count: { _all: true } }),
  ]);
  const at = new Date();
  return vendors.map((v) => {
    const mine = certs.filter((c) => c.companyId === v.id) as CertLite[];
    const w = waivers.filter((x) => x.companyId === v.id);
    const rows = types.filter((t) => applies(t as TypeRule, v)).map((t) => ({ type: t, ...evaluate(t, mine, w, at) }));
    const count = (s: CertState[]) => rows.filter((r) => s.includes(r.state)).length;
    return {
      id: v.id, name: v.tradeName ?? v.legalName, legalName: v.legalName, type: v.type, status: v.status, flag: v.country.flag,
      score: score(rows.map((r) => ({ required: r.type.required, state: r.state }))),
      missingRequired: rows.filter((r) => r.type.required && !COVERED.includes(r.state)).map((r) => r.type.name),
      expiring: count(["EXPIRING", "GRACE"]), pending: rows.filter((r) => r.pending).length, waived: count(["WAIVED"]),
      valid: count(["VALID", "EXPIRING"]), applicable: rows.length,
      pausedWhole: !!v.compliancePausedAt, pausedOffers: paused.find((p) => p.vendorCompanyId === v.id)?._count._all ?? 0,
    };
  });
}

export async function supplierCompliance(ctx: Ctx, companyId: string) {
  requireView(ctx);
  const co = await prisma.company.findFirst({ where: { id: companyId, type: { in: VENDOR_TYPES }, ...scopeWhere(ctx) }, select: { id: true, legalName: true, tradeName: true, type: true, status: true, country: { select: { flag: true } }, registryCertificateCode: true, legalForm: true } });
  if (!co) throw new NotFoundError("Supplier");
  const [c, waivers] = await Promise.all([complianceOf(companyId), prisma.complianceWaiver.findMany({ where: { companyId }, include: { type: { select: { key: true, name: true } } }, orderBy: { createdAt: "desc" } })]);
  return { company: co, ...c, waivers, canManage: canManageCompliance(ctx) };
}

export async function complianceOverview(ctx: Ctx) {
  requireView(ctx);
  const t0 = today();
  const in30 = new Date(t0.getTime() + 30 * DAY);
  const [suppliers, types, queue, expiringSoon, rechecks, recentAudit] = await Promise.all([
    supplierList(ctx),
    listTypes(ctx),
    reviewQueue(ctx),
    prisma.certificate.findMany({ where: { status: "APPROVED", supersededAt: null, expiresOn: { gte: t0, lte: in30 }, company: scopeWhere(ctx) }, include: { type: { select: { name: true, key: true, required: true } }, company: { select: { id: true, legalName: true, tradeName: true } } }, orderBy: { expiresOn: "asc" }, take: 50 }),
    prisma.certificate.findMany({ where: { status: "APPROVED", supersededAt: null, recheckDueOn: { lte: in30 }, company: scopeWhere(ctx) }, include: { type: { select: { name: true, key: true } }, company: { select: { id: true, legalName: true, tradeName: true } } }, orderBy: { recheckDueOn: "asc" }, take: 50 }),
    complianceAudit(ctx, 8),
  ]);
  const live = suppliers.filter((s) => s.status === "APPROVED");
  const compliant = live.filter((s) => !s.missingRequired.length).length;
  return {
    kpi: {
      suppliers: live.length, compliant, compliantPct: live.length ? Math.round((100 * compliant) / live.length) : 100,
      paused: live.filter((s) => s.pausedWhole || s.pausedOffers > 0).length, pendingReview: queue.length, expiring30: expiringSoon.length,
      rechecksDue: rechecks.filter((r) => r.recheckDueOn && r.recheckDueOn <= t0).length,
      avgScore: live.length ? Math.round(live.reduce((a, s) => a + s.score, 0) / live.length) : 100,
    },
    types: types.filter((t) => t.isActive), queue: queue.slice(0, 6), expiringSoon, rechecks, paused: live.filter((s) => s.pausedWhole || s.pausedOffers > 0), recentAudit,
  };
}

/** Compliance audit trail: certificate and waiver decisions, type changes, pauses, approvals without documents. */
export async function complianceAudit(ctx: Ctx, take = 200) {
  requireView(ctx);
  const rows = await withActors(prisma.auditLog.findMany({
    where: { OR: [{ action: { startsWith: "compliance." } }, { action: "company.status.approved_anyway" }] },
    orderBy: { at: "desc" }, take,
  }));
  const ids = [...new Set(rows.filter((r) => r.entityType === "Company").map((r) => r.entityId!).concat(rows.filter((r) => r.entityType === "Certificate").map((r) => r.entityId!)))];
  const [cos, certs] = await Promise.all([
    prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true, tradeName: true } }),
    prisma.certificate.findMany({ where: { id: { in: ids } }, select: { id: true, company: { select: { id: true, legalName: true, tradeName: true } }, type: { select: { name: true } } } }),
  ]);
  return rows.map((r) => {
    const cert = r.entityType === "Certificate" ? certs.find((c) => c.id === r.entityId) : null;
    const co = cert?.company ?? (r.entityType === "Company" ? cos.find((c) => c.id === r.entityId) : null);
    return { ...r, company: co ? { id: co.id, name: co.tradeName ?? co.legalName } : null, certificate: cert ? cert.type.name : null };
  });
}

async function withActors<T extends { actorUserId: string | null }>(p: Promise<T[]>) {
  const rows = await p;
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorUserId).filter(Boolean) as string[])] } }, select: { id: true, name: true, email: true } });
  return rows.map((r) => ({ ...r, actor: users.find((u) => u.id === r.actorUserId) ?? null }));
}

// ── customers: badges ───────────────────────────────────────────────────────

export type Badge = { key: string; name: string; certificateId: string | null };

/** Verified badges per supplier: approved, in date, badge switched on for the type, not hidden for the supplier. */
export async function badgesFor(vendorIds: string[]): Promise<Map<string, Badge[]>> {
  const ids = [...new Set(vendorIds.filter(Boolean))];
  const out = new Map<string, Badge[]>();
  if (!ids.length) return out;
  const certs = await prisma.certificate.findMany({
    where: { companyId: { in: ids }, status: "APPROVED", supersededAt: null, badgeHidden: false, OR: [{ expiresOn: null }, { expiresOn: { gte: today() } }], type: { badgeEnabled: true, isActive: true } },
    select: { id: true, companyId: true, type: { select: { key: true, name: true, sortOrder: true, publicDownload: true } } },
  });
  certs.sort((a, b) => a.type.sortOrder - b.type.sortOrder);
  for (const c of certs) {
    const list = out.get(c.companyId) ?? [];
    if (!list.some((b) => b.key === c.type.key)) list.push({ key: c.type.key, name: c.type.name, certificateId: c.type.publicDownload ? c.id : null });
    out.set(c.companyId, list);
  }
  return out;
}

/** Badge types customers can filter by. */
export async function badgeTypes() {
  return prisma.certificateType.findMany({ where: { badgeEnabled: true, isActive: true }, select: { key: true, name: true }, orderBy: { sortOrder: "asc" } });
}

/** Suppliers that currently hold a badge (for the catalogue filter). */
export async function vendorsWithBadge(key: string) {
  const rows = await prisma.certificate.findMany({
    where: { status: "APPROVED", supersededAt: null, badgeHidden: false, OR: [{ expiresOn: null }, { expiresOn: { gte: today() } }], type: { key, badgeEnabled: true, isActive: true } },
    select: { companyId: true }, distinct: ["companyId"],
  });
  return rows.map((r) => r.companyId);
}

/**
 * Download a certificate file: FIRINGI staff, the supplier itself, or — when the type allows public
 * download and the badge is showing — a buyer who can buy from that supplier.
 */
export async function certificateFile(ctx: Ctx, id: string) {
  const c = await prisma.certificate.findUnique({ where: { id }, include: { type: true, company: { select: { type: true } } } });
  if (!c) throw new NotFoundError("Certificate");
  let ok = false;
  if (ctx.company.type === "ADMIN") ok = canViewCompliance(ctx) && (await prisma.company.count({ where: { id: c.companyId, ...scopeWhere(ctx) } })) > 0;
  else if (ctx.company.id === c.companyId) ok = can(ctx, SUPPLIER_VIEW);
  else if (ctx.company.status === "APPROVED" && (ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER")) {
    const sells = ctx.company.type === "CUSTOMER" ? "WHOLESALER" : "DISTRIBUTOR";
    ok = c.company.type === sells && c.type.publicDownload && c.type.badgeEnabled && c.type.isActive && c.status === "APPROVED" && !c.supersededAt && !c.badgeHidden && (!c.expiresOn || c.expiresOn >= today());
  }
  if (!ok) throw new NotFoundError("Certificate");
  return { body: await readStored(c.fileKey), fileName: c.fileName, mimeType: c.mimeType };
}

/** Options for the certificate-type form: supplier countries and categories (indented by depth). */
export async function typeFormOptions(ctx: Ctx) {
  requireView(ctx);
  const [countries, cats] = await Promise.all([
    prisma.country.findMany({ where: { isActive: true }, select: { id: true, code: true, flag: true, name: true }, orderBy: { code: "asc" } }),
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true, depth: true, path: true }, orderBy: [{ path: "asc" }] }),
  ]);
  const en = (n: unknown) => (n && typeof n === "object" ? ((n as Record<string, string>).en ?? Object.values(n as Record<string, string>)[0] ?? "") : String(n ?? ""));
  return {
    countries: countries.map((c) => ({ id: c.id, label: `${c.flag ?? ""} ${en(c.name)} (${c.code})` })),
    categories: cats.map((c) => ({ id: c.id, label: `${"— ".repeat(c.depth)}${en(c.name)}` })),
  };
}

/** Is the supplier (as a whole) paused for compliance? For the supplier's own product list. */
export async function compliancePaused(ctx: Ctx) {
  if (!VENDOR_TYPES.includes(ctx.company.type)) return false;
  return !!(await prisma.company.findUnique({ where: { id: ctx.company.id }, select: { compliancePausedAt: true } }))?.compliancePausedAt;
}
