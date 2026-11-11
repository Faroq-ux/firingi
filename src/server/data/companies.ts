/** Admin read views over applicants and accounts (permission + regional-scope filtered). */
import type { AccountStatus, CompanyType, Prisma, ReviewStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { canDecideType, canReviewDocsOf, requireAdmin, scopeWhere, viewableTypes } from "@/server/services/admin-access";
import { missingForApproval } from "@/server/onboarding/rules";
import { readinessInput } from "@/server/services/company";

export type CompanyFilter = { types: CompanyType[]; statuses?: AccountStatus[]; countryCode?: string; q?: string; page?: number; pageSize?: number };

export async function listCompanies(ctx: Ctx, f: CompanyFilter) {
  requireAdmin(ctx);
  const types = f.types.filter((t) => viewableTypes(ctx).includes(t));
  if (types.length === 0) throw new ForbiddenError();
  const pageSize = Math.min(500, Math.max(1, f.pageSize ?? 50));
  const page = Math.max(1, f.page ?? 1);
  const where: Prisma.CompanyWhereInput = {
    AND: [
      { type: { in: types } },
      f.statuses?.length ? { status: { in: f.statuses } } : {},
      f.countryCode ? { country: { code: f.countryCode } } : {},
      f.q ? { OR: [{ legalName: { contains: f.q, mode: "insensitive" } }, { tradeName: { contains: f.q, mode: "insensitive" } }, { taxId: { contains: f.q } }, { email: { contains: f.q, mode: "insensitive" } }] } : {},
      scopeWhere(ctx),
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.company.findMany({
      where,
      include: {
        country: { select: { code: true, flag: true } },
        addresses: { where: { kind: "HEAD_OFFICE", isActive: true }, take: 1, select: { cityName: true } },
        _count: { select: { documents: { where: { status: "PENDING" } } } },
        vatValidations: { orderBy: { checkedAt: "desc" }, take: 1, select: { result: true } },
        commissionRules: { where: { validTo: null }, take: 1, select: { rate: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.company.count({ where }),
  ]);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function companyDetail(ctx: Ctx, id: string) {
  requireAdmin(ctx);
  const c = await prisma.company.findFirst({
    where: { id, type: { in: viewableTypes(ctx) }, ...scopeWhere(ctx) },
    include: {
      country: true,
      addresses: { where: { isActive: true }, include: { country: { select: { code: true, flag: true } } }, orderBy: [{ kind: "asc" }, { isDefault: "desc" }] },
      documents: { orderBy: { createdAt: "desc" } },
      statusHistory: { orderBy: { at: "desc" } },
      vatValidations: { orderBy: { checkedAt: "desc" }, take: 10 },
      commissionRules: { orderBy: { validFrom: "desc" }, take: 20 },
      restrictionApprovals: { include: { documents: { select: { id: true, fileName: true, status: true } } } },
      memberships: { include: { user: { select: { name: true, email: true, lastLoginAt: true } } }, orderBy: { isOwner: "desc" } },
    },
  });
  if (!c) throw new NotFoundError("Company");
  const actorIds = [...new Set([...c.statusHistory.map((h) => h.byUserId), ...c.documents.map((d) => d.reviewedById), ...c.commissionRules.map((r) => r.createdById), ...c.vatValidations.map((v) => v.checkedById)].filter(Boolean))] as string[];
  const actors = new Map((await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));
  const readiness = c.status === "UNDER_REVIEW" || c.status === "PENDING" ? missingForApproval(await readinessInput(c.id)) : [];
  return {
    company: c,
    actors,
    readiness,
    permissions: {
      decide: canDecideType(ctx, c.type),
      reviewDocs: canReviewDocsOf(ctx, c.type),
      commission: can(ctx, "admin.vendors.commission"),
      vatManual: can(ctx, "admin.risk.manage") || canDecideType(ctx, c.type),
      restrictions: can(ctx, ["admin.customers.approve", "admin.risk.manage"]),
    },
  };
}

/** Documents waiting for review (company documents and licences), oldest first. */
export async function documentQueue(ctx: Ctx, opts: { types: CompanyType[]; statuses?: ReviewStatus[] }) {
  requireAdmin(ctx);
  const types = opts.types.filter((t) => viewableTypes(ctx).includes(t));
  if (!types.length) throw new ForbiddenError();
  const rows = await prisma.document.findMany({
    where: { status: { in: opts.statuses ?? ["PENDING"] }, company: { type: { in: types }, ...scopeWhere(ctx) } },
    include: { company: { select: { id: true, legalName: true, type: true, status: true, country: { select: { flag: true, code: true } } } } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return rows.map((d) => ({ ...d, canReview: canReviewDocsOf(ctx, d.company!.type) }));
}

export async function restrictionQueue(ctx: Ctx, statuses: ReviewStatus[] = ["PENDING"]) {
  requireAdmin(ctx);
  if (!can(ctx, ["admin.customers.view", "admin.customers.approve", "admin.risk.view", "admin.risk.manage"])) throw new ForbiddenError();
  return prisma.restrictionApproval.findMany({
    where: { status: { in: statuses }, company: scopeWhere(ctx) },
    include: {
      company: { select: { id: true, legalName: true, type: true, country: { select: { flag: true } } } },
      documents: { select: { id: true, fileName: true, status: true } },
    },
    orderBy: { updatedAt: "asc" },
  });
}

export async function customerAddresses(ctx: Ctx) {
  requireAdmin(ctx);
  if (!can(ctx, ["admin.customers.view", "admin.customers.approve"])) throw new ForbiddenError();
  return prisma.address.findMany({
    where: { isActive: true, company: { type: "CUSTOMER", ...scopeWhere(ctx) } },
    include: { company: { select: { id: true, legalName: true } }, country: { select: { flag: true } } },
    orderBy: [{ company: { legalName: "asc" } }, { kind: "asc" }],
    take: 500,
  });
}

/** Vendor compliance overview: VAT / VIES and document status per vendor. */
export async function vendorCompliance(ctx: Ctx) {
  requireAdmin(ctx);
  if (!can(ctx, ["admin.vendors.view", "admin.vendors.approve", "admin.risk.view"])) throw new ForbiddenError();
  return prisma.company.findMany({
    where: { type: { in: ["DISTRIBUTOR", "WHOLESALER"] }, ...scopeWhere(ctx) },
    include: {
      country: { select: { flag: true, code: true } },
      vatValidations: { orderBy: { checkedAt: "desc" }, take: 1 },
      documents: { where: { restrictionApprovalId: null }, select: { status: true, expiresAt: true } },
      commissionRules: { where: { validTo: null }, take: 1, select: { rate: true } },
    },
    orderBy: { legalName: "asc" },
  });
}
