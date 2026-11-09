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

/** Onboarding hub data for the signed-in applicant (company and / or driver). */
export async function myApplication(ctx: Ctx) {
  const { missingForSubmission } = await import("@/server/onboarding/rules");
  const { readinessInput } = await import("@/server/services/company");
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: ctx.company.id },
    select: {
      id: true, legalName: true, tradeName: true, type: true, status: true, statusReason: true, createdAt: true, taxId: true, vatNumber: true,
      email: true, phone: true, website: true, businessType: true, countryId: true,
      country: { select: { code: true, flag: true } },
      statusHistory: { orderBy: { at: "desc" }, take: 10 },
    },
  });
  const isApplicantCompany = company.type !== "ADMIN";
  const missing = isApplicantCompany && company.status === "PENDING" ? missingForSubmission(await readinessInput(company.id)) : [];
  const driver = ctx.driver
    ? await prisma.driver.findUnique({ where: { id: ctx.driver.id }, include: { documents: { orderBy: { createdAt: "desc" } } } })
    : null;
  return { company, isApplicantCompany, missing, driver };
}
