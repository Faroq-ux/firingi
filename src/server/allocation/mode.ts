/** How a buyer orders: customers follow their country's mode; wholesalers always choose a distributor. */
import type { CustomerOrderMode } from "@prisma/client";
import { cache } from "react";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";

export const orderingMode = cache(async (ctx: Pick<Ctx, "company">): Promise<CustomerOrderMode> => {
  if (ctx.company.type !== "CUSTOMER") return "CHOOSE_SUPPLIER";
  const c = await prisma.country.findUnique({ where: { id: ctx.company.countryId }, select: { customerOrderMode: true } });
  return c?.customerOrderMode ?? "CHOOSE_SUPPLIER";
});

/** Super Admin / allocation managers: how customers in a country order. */
export async function setCustomerOrderMode(ctx: Ctx, countryId: string, mode: CustomerOrderMode) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.international.manage", "admin.allocation.manage"])) throw new ForbiddenError();
  const before = await prisma.country.findUnique({ where: { id: countryId }, select: { customerOrderMode: true } });
  if (!before) throw new NotFoundError("Country");
  await prisma.country.update({ where: { id: countryId }, data: { customerOrderMode: mode } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "country.customer_order_mode", entityType: "Country", entityId: countryId, before, after: { customerOrderMode: mode } });
}

export async function countryOrderModes() {
  return prisma.country.findMany({ where: { isActive: true, customerMarketEnabled: true }, select: { id: true, code: true, flag: true, name: true, customerOrderMode: true }, orderBy: { code: "asc" } });
}
