/**
 * Phase 47 — till staff and revenue. The owner, or a shop manager of a till, adds an employee for their tills (a
 * shop manager adds cashiers for the tills they manage; the owner also adds shop managers, for any till) and sees
 * the takings of their tills: today, last 7 days, this month, this year and all time.
 */
import "server-only";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { AppError, ForbiddenError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { requirePos } from "./settings";
import { tillAccess } from "./access";

const n2 = (v: unknown) => Number(v ?? 0);

/** The people on the tills this person manages. */
export async function tillStaff(ctx: Ctx) {
  await requirePos(ctx, "sell");
  const a = await tillAccess(ctx.company.id, ctx.user.id);
  if (!a.manage.size) throw new ForbiddenError("For the till's managers.");
  const tills = await prisma.posRegister.findMany({ where: { id: { in: [...a.manage] } }, orderBy: { code: "asc" }, select: { id: true, name: true, code: true, users: { select: { userId: true, role: true } } } });
  const ids = [...new Set(tills.flatMap((t) => t.users.map((u) => u.userId)))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, memberships: { where: { companyId: ctx.company.id }, select: { status: true } } } });
  return {
    owner: a.all, tills: tills.map((t) => ({ id: t.id, name: t.name, code: t.code })),
    people: users.map((u) => ({ userId: u.id, name: u.name, email: u.email, active: u.memberships[0]?.status === "ACTIVE", tills: tills.filter((t) => t.users.some((x) => x.userId === u.id)).map((t) => ({ id: t.id, code: t.code, role: t.users.find((x) => x.userId === u.id)!.role })) })).sort((x, y) => x.name.localeCompare(y.name)),
  };
}

/** Add an employee to tills: a new login with the Cashier role, placed on the chosen tills. */
export async function addTillEmployee(ctx: Ctx, i: { name: string; email: string; password: string; registerIds: string[]; role: "SELL" | "MANAGE" }) {
  await requirePos(ctx, "sell");
  const a = await tillAccess(ctx.company.id, ctx.user.id);
  if (!i.registerIds.length) throw new ValidationError("Choose the till(s).");
  if (i.registerIds.some((r) => !a.manage.has(r))) throw new ForbiddenError("You can add people only to the tills you manage.");
  if (i.role === "MANAGE" && !a.all) throw new ForbiddenError("Only the owner adds shop managers.");
  if (!i.name.trim()) throw new ValidationError("Enter the employee's name.");
  const email = i.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError("Check the e-mail.");
  if (i.password.length < 10) throw new ValidationError("The first password needs at least 10 characters (the employee changes it after signing in).");
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, memberships: { where: { companyId: ctx.company.id }, select: { id: true } } } });
  if (existing && !existing.memberships.length) throw new AppError("EMAIL_TAKEN", "A user with this e-mail already exists.", 409);
  const role = await prisma.role.findFirstOrThrow({ where: { companyId: null, key: "POS_CASHIER" } });
  if (!existing) await (await import("@/server/plans/service")).assertWithinLimit(ctx.company.id, "users");
  const userId = await prisma.$transaction(async (tx) => {
    let uid = existing?.id;
    if (!uid) {
      const u = await tx.user.create({ data: { email, name: i.name.trim().slice(0, 80), emailVerified: false } });
      await tx.account.create({ data: { userId: u.id, accountId: u.id, providerId: "credential", password: await hashPassword(i.password) } });
      const m = await tx.membership.create({ data: { userId: u.id, companyId: ctx.company.id, jobTitle: i.role === "MANAGE" ? "Shop manager" : "Cashier", createdById: ctx.user.id, roles: { create: { roleId: role.id, assignedById: ctx.user.id } } } });
      await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "member.created", entityType: "Membership", entityId: m.id, after: { email, roles: ["POS_CASHIER"], via: "till" } }, tx);
      uid = u.id;
    } else {
      // already in the company: make sure they have the till right
      const m = await tx.membership.findFirstOrThrow({ where: { userId: uid, companyId: ctx.company.id } });
      await tx.membershipRole.upsert({ where: { membershipId_roleId: { membershipId: m.id, roleId: role.id } }, update: {}, create: { membershipId: m.id, roleId: role.id, assignedById: ctx.user.id } });
    }
    for (const r of i.registerIds) await tx.posRegisterUser.upsert({ where: { registerId_userId: { registerId: r, userId: uid } }, update: { role: i.role }, create: { registerId: r, userId: uid, role: i.role } });
    return uid;
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pos.staff.add", entityType: "User", entityId: userId, after: { tills: i.registerIds, role: i.role } });
  return { userId };
}

/** Take someone off one of my tills (the owner removes the person from the company under Team). */
export async function removeFromTill(ctx: Ctx, registerId: string, userId: string) {
  await requirePos(ctx, "sell");
  const a = await tillAccess(ctx.company.id, ctx.user.id);
  if (!a.manage.has(registerId)) throw new ForbiddenError();
  const row = await prisma.posRegisterUser.findUnique({ where: { registerId_userId: { registerId, userId } } });
  if (!row) return { ok: true };
  if (row.role === "MANAGE" && !a.all) throw new ForbiddenError("Only the owner changes shop managers.");
  await prisma.posRegisterUser.delete({ where: { registerId_userId: { registerId, userId } } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pos.staff.remove", entityType: "User", entityId: userId, after: { till: registerId } });
  return { ok: true };
}

/** Takings of the tills this person manages: today, 7 days, this month, this year, all time — in total and per till. */
export async function tillRevenue(ctx: Ctx, now = new Date()) {
  await requirePos(ctx, "sell");
  const a = await tillAccess(ctx.company.id, ctx.user.id);
  if (!a.manage.size) return null;
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  const periods = {
    today: day,
    week: new Date(day.getTime() - 6 * 86_400_000),
    month: new Date(day.getFullYear(), day.getMonth(), 1),
    year: new Date(day.getFullYear(), 0, 1),
    all: new Date(0),
  };
  const regs = [...a.manage];
  const rows = await prisma.posSale.groupBy({ by: ["registerId", "kind"], where: { companyId: ctx.company.id, status: "COMPLETED", registerId: { in: regs } }, _sum: { gross: true }, _count: { _all: true }, _min: { soldAt: true } });
  const sums: Record<keyof typeof periods, number> = { today: 0, week: 0, month: 0, year: 0, all: 0 };
  const perTill: Record<string, Record<keyof typeof periods, number>> = {};
  for (const [k, from] of Object.entries(periods) as [keyof typeof periods, Date][]) {
    const g = k === "all" ? rows : await prisma.posSale.groupBy({ by: ["registerId", "kind"], where: { companyId: ctx.company.id, status: "COMPLETED", registerId: { in: regs }, soldAt: { gte: from } }, _sum: { gross: true } });
    for (const r of g) {
      const v = (r.kind === "REFUND" ? -1 : 1) * n2(r._sum.gross);
      sums[k] = Math.round((sums[k] + v) * 100) / 100;
      perTill[r.registerId] ??= { today: 0, week: 0, month: 0, year: 0, all: 0 };
      perTill[r.registerId][k] = Math.round((perTill[r.registerId][k] + v) * 100) / 100;
    }
  }
  const tills = await prisma.posRegister.findMany({ where: { id: { in: regs } }, select: { id: true, name: true, code: true, branch: { select: { name: true } } }, orderBy: { code: "asc" } });
  const first = rows.reduce<Date | null>((m, r) => (r._min.soldAt && (!m || r._min.soldAt < m) ? r._min.soldAt : m), null);
  return { total: sums, since: first, tills: tills.map((t) => ({ id: t.id, name: t.name, code: t.code, shop: t.branch?.name ?? null, ...(perTill[t.id] ?? { today: 0, week: 0, month: 0, year: 0, all: 0 }) })) };
}
