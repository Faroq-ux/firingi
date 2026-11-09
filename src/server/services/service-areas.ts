/**
 * Vendor service areas (where a vendor sells) and FIRINGI delivery zones.
 *   • Wholesalers: only areas inside their own country.
 *   • Distributors: any active (Schengen) country — cross-border.
 *   • No areas = default reach (see delivery/coverage.ts).
 */
import type { Prisma, ServiceAreaType } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { checkPolygon, isValidPostalPattern, setZoneArea } from "@/server/delivery/coverage";
import { writeAudit } from "./audit";

function requireVendorAreas(ctx: Ctx) {
  if ((ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") || !can(ctx, "vendor.service_areas.manage")) throw new ForbiddenError();
}

const areaInclude = {
  country: { select: { code: true, flag: true, name: true } },
  region: { select: { name: true } },
  city: { select: { name: true } },
  zone: { select: { name: true, isActive: true } },
  originAddress: { select: { label: true, cityName: true } },
} satisfies Prisma.VendorServiceAreaInclude;

export async function listOwnServiceAreas(ctx: Ctx) {
  if (ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") throw new ForbiddenError();
  if (!can(ctx, ["vendor.service_areas.manage", "vendor.fleet.view"])) throw new ForbiddenError();
  return prisma.vendorServiceArea.findMany({ where: { vendorCompanyId: ctx.company.id, isActive: true }, include: areaInclude, orderBy: { createdAt: "asc" } });
}

/** Choices for the "add area" form. */
export async function serviceAreaOptions(ctx: Ctx) {
  requireVendorAreas(ctx);
  const countryWhere: Prisma.CountryWhereInput = ctx.company.type === "WHOLESALER" ? { id: ctx.company.countryId } : { isActive: true, isEU: true };
  const [countries, regions, cities, zones, origins] = await Promise.all([
    prisma.country.findMany({ where: countryWhere, select: { id: true, code: true, flag: true, name: true }, orderBy: { code: "asc" } }),
    prisma.region.findMany({ where: { country: countryWhere }, select: { id: true, name: true, countryId: true }, orderBy: { code: "asc" } }),
    prisma.city.findMany({ where: { country: countryWhere, isActive: true }, select: { id: true, name: true, countryId: true }, orderBy: { name: "asc" } }),
    prisma.deliveryZone.findMany({ where: { country: countryWhere, isActive: true }, select: { id: true, name: true, countryId: true }, orderBy: { name: "asc" } }),
    prisma.address.findMany({
      where: { companyId: ctx.company.id, isActive: true, kind: { in: ["WAREHOUSE", "PICKUP", "HEAD_OFFICE"] }, latitude: { not: null } },
      select: { id: true, label: true, cityName: true, countryId: true },
    }),
  ]);
  return { countries, regions, cities, zones, origins };
}

export type ServiceAreaInput = {
  type: ServiceAreaType;
  countryId?: string | null;
  regionId?: string | null;
  cityId?: string | null;
  zoneId?: string | null;
  originAddressId?: string | null;
  radiusKm?: number | string | null;
};

export async function addServiceArea(ctx: Ctx, input: ServiceAreaInput) {
  requireVendorAreas(ctx);
  const data: Prisma.VendorServiceAreaUncheckedCreateInput = { vendorCompanyId: ctx.company.id, type: input.type, countryId: "" };
  switch (input.type) {
    case "COUNTRY": {
      if (!input.countryId) throw new ValidationError("Choose a country.");
      data.countryId = input.countryId;
      break;
    }
    case "REGION": {
      const r = input.regionId ? await prisma.region.findUnique({ where: { id: input.regionId } }) : null;
      if (!r) throw new ValidationError("Choose a region.");
      Object.assign(data, { countryId: r.countryId, regionId: r.id });
      break;
    }
    case "CITY": {
      const c = input.cityId ? await prisma.city.findUnique({ where: { id: input.cityId } }) : null;
      if (!c) throw new ValidationError("Choose a city.");
      Object.assign(data, { countryId: c.countryId, cityId: c.id });
      break;
    }
    case "ZONE": {
      const z = input.zoneId ? await prisma.deliveryZone.findFirst({ where: { id: input.zoneId, isActive: true } }) : null;
      if (!z) throw new ValidationError("Choose a delivery zone.");
      Object.assign(data, { countryId: z.countryId, zoneId: z.id });
      break;
    }
    case "RADIUS_KM": {
      const o = input.originAddressId
        ? await prisma.address.findFirst({ where: { id: input.originAddressId, companyId: ctx.company.id, isActive: true, latitude: { not: null } } })
        : null;
      if (!o) throw new ValidationError("Choose one of your addresses as the centre.");
      const km = Number(input.radiusKm);
      if (!Number.isFinite(km) || km < 1 || km > 1000) throw new ValidationError("Radius must be between 1 and 1000 km.");
      Object.assign(data, { countryId: o.countryId, originAddressId: o.id, radiusKm: km.toFixed(2) });
      break;
    }
    default:
      throw new ValidationError("Unknown area type.");
  }
  const country = await prisma.country.findUnique({ where: { id: data.countryId } });
  if (!country || !country.isActive) throw new ValidationError("That country is not available.");
  if (ctx.company.type === "WHOLESALER" && country.id !== ctx.company.countryId)
    throw new ValidationError("Wholesalers sell only inside their own country.");
  if (ctx.company.type === "DISTRIBUTOR" && !country.isEU)
    throw new ValidationError("Selling to this country needs customs handling, which is not available yet.");
  const dup = await prisma.vendorServiceArea.findFirst({
    where: { vendorCompanyId: ctx.company.id, isActive: true, type: data.type, countryId: data.countryId, regionId: data.regionId ?? null, cityId: data.cityId ?? null, zoneId: data.zoneId ?? null, originAddressId: data.originAddressId ?? null, radiusKm: data.radiusKm ?? null },
  });
  if (dup) throw new ValidationError("You already have this area.");
  const area = await prisma.$transaction(async (tx) => {
    const a = await tx.vendorServiceArea.create({ data });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "service_area.added", entityType: "VendorServiceArea", entityId: a.id, after: { ...input } }, tx);
    return a;
  });
  return area;
}

export async function removeServiceArea(ctx: Ctx, id: string) {
  requireVendorAreas(ctx);
  const a = await prisma.vendorServiceArea.findFirst({ where: { id, vendorCompanyId: ctx.company.id, isActive: true } });
  if (!a) throw new NotFoundError("Service area");
  await prisma.$transaction(async (tx) => {
    await tx.vendorServiceArea.update({ where: { id }, data: { isActive: false } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "service_area.removed", entityType: "VendorServiceArea", entityId: id, before: { type: a.type } }, tx);
  });
}

// ── FIRINGI delivery zones ───────────────────────────────────────────────────

function requireZones(ctx: Ctx, manage = false) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  if (!can(ctx, manage ? "admin.delivery.manage" : ["admin.delivery.view", "admin.delivery.manage", "admin.international.view"])) throw new ForbiddenError();
}

export async function listZones(ctx: Ctx) {
  requireZones(ctx);
  const zones = await prisma.deliveryZone.findMany({
    include: { country: { select: { code: true, flag: true } }, _count: { select: { serviceAreas: { where: { isActive: true } } } } },
    orderBy: [{ country: { code: "asc" } }, { name: "asc" }],
  });
  const km2 = await prisma.$queryRaw<{ id: string; km2: number | null }[]>`SELECT id, postgis.ST_Area(area) / 1e6 AS km2 FROM "DeliveryZone"`;
  const area = new Map(km2.map((r) => [r.id, r.km2 == null ? null : Number(r.km2)]));
  return zones.map((z) => ({ ...z, areaKm2: area.get(z.id) ?? null }));
}

export async function listAllServiceAreas(ctx: Ctx) {
  requireZones(ctx);
  return prisma.vendorServiceArea.findMany({
    where: { isActive: true },
    include: { ...areaInclude, vendor: { select: { id: true, legalName: true, type: true } } },
    orderBy: [{ vendor: { legalName: "asc" } }, { createdAt: "asc" }],
  });
}

export type ZoneInput = { countryCode: string; name: string; postalCodePatterns: string[]; polygon?: unknown | null };

async function cleanZone(input: ZoneInput) {
  const country = await prisma.country.findUnique({ where: { code: input.countryCode } });
  if (!country || !country.isActive) throw new ValidationError("Choose an active country.");
  const name = input.name.trim();
  if (name.length < 2) throw new ValidationError("Give the zone a name.");
  const patterns = [...new Set(input.postalCodePatterns.map((p) => p.trim().toUpperCase()).filter(Boolean))];
  const bad = patterns.filter((p) => !isValidPostalPattern(p));
  if (bad.length) throw new ValidationError(`Invalid postal code pattern: ${bad.join(", ")}. Use digits, letters, - and * (e.g. 1000-*).`);
  if (input.polygon != null) {
    const r = await checkPolygon(input.polygon);
    if (!r.ok) throw new ValidationError(r.error);
  }
  if (!patterns.length && input.polygon == null) throw new ValidationError("Add postal code patterns, a map area (GeoJSON), or both.");
  return { country, name, patterns };
}

export async function createZone(ctx: Ctx, input: ZoneInput) {
  requireZones(ctx, true);
  const { country, name, patterns } = await cleanZone(input);
  return prisma.$transaction(async (tx) => {
    const z = await tx.deliveryZone.create({ data: { countryId: country.id, name, postalCodePatterns: patterns } });
    if (input.polygon != null) await setZoneArea(z.id, input.polygon, tx);
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "zone.created", entityType: "DeliveryZone", entityId: z.id, after: { name, country: country.code, patterns, polygon: input.polygon != null } }, tx);
    return z;
  });
}

export async function updateZone(ctx: Ctx, id: string, input: ZoneInput) {
  requireZones(ctx, true);
  const z = await prisma.deliveryZone.findUnique({ where: { id } });
  if (!z) throw new NotFoundError("Zone");
  const { country, name, patterns } = await cleanZone(input);
  await prisma.$transaction(async (tx) => {
    await tx.deliveryZone.update({ where: { id }, data: { countryId: country.id, name, postalCodePatterns: patterns } });
    await setZoneArea(id, input.polygon ?? null, tx);
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "zone.updated", entityType: "DeliveryZone", entityId: id, before: { name: z.name, patterns: z.postalCodePatterns }, after: { name, patterns, polygon: input.polygon != null } }, tx);
  });
}

export async function setZoneActive(ctx: Ctx, id: string, active: boolean) {
  requireZones(ctx, true);
  const z = await prisma.deliveryZone.findUnique({ where: { id } });
  if (!z) throw new NotFoundError("Zone");
  await prisma.$transaction(async (tx) => {
    await tx.deliveryZone.update({ where: { id }, data: { isActive: active } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: active ? "zone.activated" : "zone.deactivated", entityType: "DeliveryZone", entityId: id }, tx);
  });
}
