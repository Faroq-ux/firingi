/** Company addresses (warehouse / pickup for vendors, delivery for buyers). */
import type { AddressKind } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { ADDRESS_KINDS, addressMustBeDomestic } from "@/server/onboarding/rules";
import { writeAudit } from "./audit";

export type AddressInput = {
  id?: string; kind: AddressKind; label: string; line1: string; line2?: string | null; postalCode: string;
  countryCode: string; cityId?: string | null; cityName: string; contactName?: string | null; phone?: string | null; isDefault?: boolean;
};

function canManage(ctx: Ctx, kind?: AddressKind) {
  if (can(ctx, "company.addresses.manage")) return true;
  // Purchasers may maintain delivery addresses without full company rights.
  return kind === "DELIVERY" && can(ctx, "buyer.addresses.manage");
}

export async function listOwnAddresses(ctx: Ctx) {
  if (!canManage(ctx) && !can(ctx, "buyer.addresses.manage") && !can(ctx, "company.profile.manage")) throw new ForbiddenError();
  return prisma.address.findMany({
    where: { companyId: ctx.company.id, isActive: true },
    include: { country: { select: { code: true, flag: true } } },
    orderBy: [{ kind: "asc" }, { isDefault: "desc" }, { createdAt: "asc" }],
  });
}

export async function saveAddress(ctx: Ctx, input: AddressInput) {
  if (ctx.company.type === "ADMIN") throw new ForbiddenError();
  if (!canManage(ctx, input.kind)) throw new ForbiddenError();
  if (!ADDRESS_KINDS[ctx.company.type].includes(input.kind)) throw new ValidationError("This address type is not available for your account.");
  const country = await prisma.country.findUnique({ where: { code: input.countryCode } });
  if (!country || !country.isEU) throw new ValidationError("Please choose an EU country.");
  if (addressMustBeDomestic(ctx.company.type, input.kind) && country.id !== ctx.company.countryId)
    throw new ValidationError("This address must be in your company's country.");
  let lat = null, lng = null;
  if (input.cityId) {
    const city = await prisma.city.findFirst({ where: { id: input.cityId, countryId: country.id } });
    if (!city) throw new ValidationError("City does not belong to the selected country.");
    // Until address-level geocoding is connected, use the city's coordinates.
    lat = city.latitude; lng = city.longitude;
  }
  const data = {
    kind: input.kind, label: input.label.trim(), line1: input.line1.trim(), line2: input.line2?.trim() || null, postalCode: input.postalCode.trim(),
    countryId: country.id, cityId: input.cityId || null, cityName: input.cityName.trim(), contactName: input.contactName?.trim() || null,
    phone: input.phone?.trim() || null, latitude: lat, longitude: lng,
  };
  return prisma.$transaction(async (tx) => {
    let existing = null;
    if (input.id) {
      existing = await tx.address.findFirst({ where: { id: input.id, companyId: ctx.company.id, isActive: true } });
      if (!existing) throw new NotFoundError("Address");
      if (existing.kind !== input.kind && !canManage(ctx, existing.kind)) throw new ForbiddenError();
      if (existing.kind === "HEAD_OFFICE" && input.kind !== "HEAD_OFFICE") throw new ValidationError("The head office address can't change type.");
    }
    if (input.isDefault) await tx.address.updateMany({ where: { companyId: ctx.company.id, kind: input.kind, isDefault: true }, data: { isDefault: false } });
    const isFirstOfKind = !(await tx.address.count({ where: { companyId: ctx.company.id, kind: input.kind, isActive: true, NOT: input.id ? { id: input.id } : undefined } }));
    const row = input.id
      ? await tx.address.update({
          where: { id: input.id },
          data: { ...data, isDefault: !!input.isDefault || isFirstOfKind || (existing!.kind === input.kind && existing!.isDefault) },
        })
      : await tx.address.create({ data: { ...data, companyId: ctx.company.id, isDefault: !!input.isDefault || isFirstOfKind } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: input.id ? "address.updated" : "address.created", entityType: "Address", entityId: row.id, after: data }, tx);
    return row;
  });
}

export async function removeAddress(ctx: Ctx, id: string) {
  const a = await prisma.address.findFirst({ where: { id, companyId: ctx.company.id, isActive: true } });
  if (!a) throw new NotFoundError("Address");
  if (!canManage(ctx, a.kind)) throw new ForbiddenError();
  if (a.kind === "HEAD_OFFICE") throw new ValidationError("The head office address can be edited but not removed.");
  // Soft delete: past orders keep referencing it.
  await prisma.address.update({ where: { id }, data: { isActive: false, isDefault: false } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "address.removed", entityType: "Address", entityId: id });
}
