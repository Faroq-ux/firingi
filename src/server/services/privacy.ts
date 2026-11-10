/**
 * Data privacy (GDPR).
 *   • Access / portability: anyone downloads a JSON copy of their personal data, any time.
 *   • Erasure: a person asks to be deleted; FIRINGI reviews it (someone must stay responsible
 *     for each company) and then anonymises the account. Invoices, orders and the audit log are
 *     kept — Portuguese law requires invoicing records for 10 years — but no longer point to a
 *     named person: name, e-mail, phone, consents, password, two-factor, devices and
 *     notification history are removed. The audit log is append-only (tamper-proof security
 *     record): its entries stay and now point to the anonymised account.
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";

const HANDLERS = ["admin.users.manage", "admin.settings.manage"] as const;
const requireHandler = (ctx: Ctx) => { if (ctx.company.type !== "ADMIN" || !can(ctx, [...HANDLERS])) throw new ForbiddenError(); };

/** Everything FIRINGI holds about this person (not company data such as invoices). */
export async function personalData(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true, email: true, name: true, phone: true, locale: true, emailVerified: true, status: true, createdAt: true, lastLoginAt: true,
      smsConsentAt: true, whatsappConsentAt: true, twoFactorEnabled: true,
      memberships: { select: { isOwner: true, status: true, jobTitle: true, createdAt: true, company: { select: { legalName: true, type: true } }, roles: { select: { role: { select: { name: true } } } } } },
      driver: { select: { licenceNumber: true, licenceExpiry: true, status: true, createdAt: true } },
      sessions: { select: { createdAt: true, updatedAt: true, ipAddress: true, userAgent: true, expiresAt: true } },
      notificationPreferences: { select: { category: true, channel: true, enabled: true } },
      pushSubscriptions: { select: { userAgent: true, createdAt: true } },
      notifications: { select: { title: true, body: true, link: true, createdAt: true, readAt: true }, orderBy: { createdAt: "desc" }, take: 1000 },
      notificationMessages: { select: { channel: true, to: true, subject: true, body: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1000 },
      inboundMessages: { select: { channel: true, from: true, body: true, receivedAt: true }, orderBy: { receivedAt: "desc" }, take: 1000 },
      ordersPlaced: { select: { number: true, placedAt: true, status: true }, orderBy: { placedAt: "desc" }, take: 1000 },
      dataRequests: { select: { type: true, status: true, requestedAt: true, handledAt: true, note: true } },
    },
  });
  const activity = await prisma.auditLog.findMany({ where: { actorUserId: userId }, select: { at: true, action: true, entityType: true, ip: true, userAgent: true }, orderBy: { at: "desc" }, take: 2000 });
  return {
    exportedAt: new Date().toISOString(),
    controller: "FIRINGI — data controller for the account data below. Company records (orders, invoices) belong to your company and FIRINGI's legal archive.",
    account: { ...u, memberships: u.memberships.map((m) => ({ ...m, roles: m.roles.map((r) => r.role.name) })) },
    activity,
  };
}

export async function exportMyData(ctx: Ctx) {
  const data = await personalData(ctx.user.id);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "privacy.exported", entityType: "User", entityId: ctx.user.id });
  return data;
}

export async function myErasureRequest(ctx: Ctx) {
  return prisma.dataRequest.findFirst({ where: { userId: ctx.user.id, type: "ERASURE" }, orderBy: { requestedAt: "desc" } });
}

export async function requestErasure(ctx: Ctx, reason?: string | null) {
  const open = await prisma.dataRequest.findFirst({ where: { userId: ctx.user.id, type: "ERASURE", status: "REQUESTED" } });
  if (open) throw new ValidationError("You already asked for this — FIRINGI will answer soon.");
  const r = await prisma.dataRequest.create({ data: { userId: ctx.user.id, type: "ERASURE", reason: reason?.trim() || null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "privacy.erasure_requested", entityType: "User", entityId: ctx.user.id });
  return r;
}

export async function withdrawErasure(ctx: Ctx) {
  const r = await prisma.dataRequest.updateMany({ where: { userId: ctx.user.id, type: "ERASURE", status: "REQUESTED" }, data: { status: "WITHDRAWN", handledAt: new Date() } });
  if (!r.count) throw new NotFoundError("Request");
}

/** Why this account can't be erased yet (empty = it can). */
export async function erasureBlockers(userId: string) {
  const owned = await prisma.membership.findMany({ where: { userId, isOwner: true, status: "ACTIVE", company: { status: { in: ["APPROVED", "PENDING", "UNDER_REVIEW"] } } }, select: { companyId: true, company: { select: { legalName: true } } } });
  const out: string[] = [];
  for (const m of owned) {
    const others = await prisma.membership.count({ where: { companyId: m.companyId, isOwner: true, status: "ACTIVE", userId: { not: userId } } });
    if (!others) out.push(`Only owner of ${m.company.legalName} — make someone else owner (or close the company) first.`);
  }
  const driving = await prisma.delivery.count({ where: { driver: { userId }, status: { in: ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"] } } });
  if (driving) out.push(`Has ${driving} delivery(ies) in progress.`);
  return out;
}

export async function listDataRequests(ctx: Ctx, status?: string) {
  requireHandler(ctx);
  const rows = await prisma.dataRequest.findMany({
    where: status ? { status: status as never } : {},
    include: { user: { select: { id: true, name: true, email: true, status: true, memberships: { select: { company: { select: { legalName: true } } } } } } },
    orderBy: { requestedAt: "desc" }, take: 200,
  });
  return Promise.all(rows.map(async (r) => ({ ...r, blockers: r.status === "REQUESTED" ? await erasureBlockers(r.userId) : [] })));
}

/** Anonymise the person. Company records stay (legal retention) without their identity. */
export async function completeErasure(ctx: Ctx, requestId: string, note?: string | null) {
  requireHandler(ctx);
  const req = await prisma.dataRequest.findUnique({ where: { id: requestId } });
  if (!req || req.status !== "REQUESTED") throw new NotFoundError("Open request");
  if (req.userId === ctx.user.id) throw new ValidationError("Someone else must handle your own request.");
  const blockers = await erasureBlockers(req.userId);
  if (blockers.length) throw new AppError("ERASURE_BLOCKED", blockers.join(" "), 409);
  const id = req.userId;
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { userId: id } }),
    prisma.account.deleteMany({ where: { userId: id } }),
    prisma.twoFactor.deleteMany({ where: { userId: id } }),
    prisma.pushSubscription.deleteMany({ where: { userId: id } }),
    prisma.notificationPreference.deleteMany({ where: { userId: id } }),
    prisma.notification.deleteMany({ where: { userId: id } }),
    prisma.notificationMessage.updateMany({ where: { userId: id }, data: { to: "[deleted]", body: "[deleted]", subject: null } }),
    prisma.inboundMessage.updateMany({ where: { userId: id }, data: { from: "[deleted]", body: "[deleted]", mediaUrl: null } }),
    prisma.membership.updateMany({ where: { userId: id }, data: { status: "DISABLED", isOwner: false, jobTitle: null } }),
    prisma.cart.deleteMany({ where: { userId: id } }),
    prisma.user.update({
      where: { id },
      data: { name: "Deleted user", email: `deleted-${id}@deleted.invalid`, phone: null, image: null, smsConsentAt: null, whatsappConsentAt: null, twoFactorEnabled: false, status: "DISABLED", emailVerified: false },
    }),
    prisma.dataRequest.update({ where: { id: requestId }, data: { status: "COMPLETED", handledById: ctx.user.id, handledAt: new Date(), note: note?.trim() || null } }),
  ]);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "privacy.erased", entityType: "User", entityId: id });
}

export async function rejectErasure(ctx: Ctx, requestId: string, note: string) {
  requireHandler(ctx);
  if (!note.trim()) throw new ValidationError("Explain why (the person sees this).");
  const r = await prisma.dataRequest.updateMany({ where: { id: requestId, status: "REQUESTED" }, data: { status: "REJECTED", handledById: ctx.user.id, handledAt: new Date(), note: note.trim() } });
  if (!r.count) throw new NotFoundError("Open request");
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "privacy.erasure_rejected", entityType: "DataRequest", entityId: requestId, after: { note } });
}

/** Back office: export someone's data (e.g. a request by e-mail or post). */
export async function exportUserData(ctx: Ctx, email: string) {
  requireHandler(ctx);
  const u = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!u) throw new NotFoundError("User");
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "privacy.exported_by_firingi", entityType: "User", entityId: u.id });
  return personalData(u.id);
}
