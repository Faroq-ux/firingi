/** Admin-side views across companies (e.g. "Vendor Users"). */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { requirePermission } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";

export async function listVendorUsers(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  requirePermission(ctx, ["admin.users.view", "admin.users.manage"]);
  return prisma.membership.findMany({
    where: { company: { type: { in: ["DISTRIBUTOR", "WHOLESALER"] } } },
    include: {
      user: { select: { name: true, email: true, status: true, lastLoginAt: true } },
      company: { select: { legalName: true, type: true, status: true, country: { select: { code: true, flag: true } } } },
      roles: { include: { role: { select: { name: true } } } },
    },
    orderBy: [{ company: { legalName: "asc" } }, { isOwner: "desc" }],
  });
}

/** Application status page — available to members of non-approved companies. */
export async function myApplication(ctx: Ctx) {
  return prisma.company.findUniqueOrThrow({
    where: { id: ctx.company.id },
    select: {
      legalName: true,
      type: true,
      status: true,
      statusReason: true,
      createdAt: true,
      statusHistory: { orderBy: { at: "desc" }, take: 10 },
      documents: { select: { id: true, type: true, status: true, fileName: true, createdAt: true } },
    },
  });
}
