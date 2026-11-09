/** FIRINGI review of driver applications (independent drivers; vendor drivers come in Phase 6). */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { REQUIRED_DRIVER_DOCUMENTS } from "@/server/onboarding/rules";
import { writeAudit } from "./audit";
import { notifyUser } from "./notify";

export async function listDriverApplications(ctx: Ctx, opts: { pendingOnly?: boolean } = {}) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.fleet.view", "admin.fleet.manage"])) throw new ForbiddenError();
  return prisma.driver.findMany({
    where: opts.pendingOnly ? { status: { in: ["PENDING", "UNDER_REVIEW"] } } : {},
    include: {
      user: { select: { name: true, email: true, phone: true } },
      owner: { select: { legalName: true, type: true } },
      documents: { select: { id: true, type: true, status: true, fileName: true, createdAt: true, reviewNote: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function reviewDriver(ctx: Ctx, driverId: string, to: "APPROVED" | "REJECTED" | "SUSPENDED", reason?: string | null) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.fleet.manage")) throw new ForbiddenError();
  const d = await prisma.driver.findUnique({ where: { id: driverId }, include: { documents: true } });
  if (!d) throw new NotFoundError("Driver");
  const allowed: Record<string, string[]> = { PENDING: ["APPROVED", "REJECTED"], UNDER_REVIEW: ["APPROVED", "REJECTED"], APPROVED: ["SUSPENDED"], SUSPENDED: ["APPROVED"], REJECTED: [] };
  if (!allowed[d.status].includes(to)) throw new AppError("BAD_TRANSITION", `Cannot change driver from ${d.status} to ${to}.`);
  if (to !== "APPROVED" && !reason?.trim()) throw new ValidationError("Please give a reason.");
  if (to === "APPROVED") {
    const missing = REQUIRED_DRIVER_DOCUMENTS.filter((t) => !d.documents.some((x) => x.type === t && x.status === "APPROVED"));
    if (missing.length) throw new ValidationError(`Approve these documents first: ${missing.join(", ").replace(/_/g, " ").toLowerCase()}.`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.driver.update({ where: { id: driverId }, data: { status: to } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `driver.${to.toLowerCase()}`, entityType: "Driver", entityId: driverId, before: { status: d.status }, after: { status: to, reason } }, tx);
  });
  await notifyUser(d.userId, {
    type: `driver.${to.toLowerCase()}`,
    title: to === "APPROVED" ? "Driver account approved" : to === "REJECTED" ? "Driver application not approved" : "Driver account suspended",
    body: to === "APPROVED" ? "You can now sign in to the FIRINGI driver portal." : `Reason: ${reason}`,
    link: "/",
  });
}
