/** Reads for a company's own self-service pages (always scoped to ctx.company). */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";
import { pickLocalized } from "@/i18n/config";

export async function ownCompanyProfile(ctx: Ctx) {
  return prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, include: { country: true } });
}

export async function listOwnCompanyDocuments(ctx: Ctx) {
  if (!can(ctx, ["company.documents.manage", "company.profile.manage"])) throw new ForbiddenError();
  return prisma.document.findMany({ where: { companyId: ctx.company.id, restrictionApprovalId: null }, orderBy: { createdAt: "desc" } });
}

/** EU countries + seeded cities for address forms (labels in English; flags make them recognisable). */
export async function euCountryOptions() {
  const rows = await prisma.country.findMany({
    where: { isEU: true, isActive: true },
    select: { code: true, name: true, flag: true, cities: { where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } } },
    orderBy: { code: "asc" },
  });
  return rows.map((c) => ({ code: c.code, label: `${c.flag ?? ""} ${pickLocalized(c.name, "en")}`, cities: c.cities }));
}

/** The vendor's own current commission and delivered orders. */
export async function ownCommission(ctx: Ctx) {
  if (ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") throw new ForbiddenError();
  const [current, orders] = await Promise.all([
    prisma.commissionRule.findFirst({ where: { vendorCompanyId: ctx.company.id, validTo: null }, orderBy: { validFrom: "desc" } }),
    prisma.order.findMany({ where: { sellerCompanyId: ctx.company.id, status: "DELIVERED" }, orderBy: { placedAt: "desc" }, take: 100, select: { id: true, number: true, placedAt: true, netTotal: true, commissionTotal: true, vendorPayableNet: true } }),
  ]);
  return { current, orders };
}
