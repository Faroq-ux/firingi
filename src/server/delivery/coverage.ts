/**
 * Where a vendor sells — service-area coverage (PostGIS).
 *
 *   • A vendor WITHOUT active service areas keeps the default reach: wholesalers their own
 *     country, distributors any EU Schengen country.
 *   • A vendor WITH active areas only reaches buyers whose delivery address is covered by
 *     at least one of them:
 *       COUNTRY   — the address is in that country (distributors, cross-border)
 *       REGION    — the address's city is in that region
 *       CITY      — the address is in that city
 *       ZONE      — the address's postal code matches one of the zone's patterns, or its point
 *                   lies inside the zone's polygon
 *       RADIUS_KM — the address is within N km of one of the vendor's own addresses
 *                   (geodesic distance, ST_DWithin on geography)
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

type Db = Prisma.TransactionClient | typeof prisma;

/** "1000-*" / "11*" / "4000-123" → SQL LIKE pattern (only * is a wildcard). */
export function postalPatternToLike(pattern: string): string {
  return pattern.trim().toUpperCase().replace(/[%_\\]/g, (c) => `\\${c}`).replace(/\*/g, "%");
}

/** Same rule in TypeScript (for validation messages and tests). */
export function postalMatches(postalCode: string, patterns: string[]): boolean {
  const pc = postalCode.trim().toUpperCase();
  return patterns.some((p) => new RegExp(`^${p.trim().toUpperCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(pc));
}

/** Valid postal pattern: letters, digits, space, dash and * (at least one non-wildcard char). */
export function isValidPostalPattern(p: string): boolean {
  return /^[A-Z0-9 *-]{1,12}$/i.test(p.trim()) && /[A-Z0-9]/i.test(p);
}

const coveredSql = (addressId: string, vendorIds: string[] | null) => Prisma.sql`
  SELECT DISTINCT a."vendorCompanyId" AS id
  FROM "VendorServiceArea" a
  JOIN "Address" b ON b.id = ${addressId}
  LEFT JOIN "City" bc ON bc.id = b."cityId"
  LEFT JOIN "Address" o ON o.id = a."originAddressId"
  LEFT JOIN "DeliveryZone" z ON z.id = a."zoneId"
  WHERE a."isActive" AND a."countryId" = b."countryId"
    ${vendorIds ? Prisma.sql`AND a."vendorCompanyId" IN (${Prisma.join(vendorIds)})` : Prisma.empty}
    AND (
      a.type = 'COUNTRY'
      OR (a.type = 'REGION' AND a."regionId" = bc."regionId")
      OR (a.type = 'CITY' AND a."cityId" = b."cityId")
      OR (a.type = 'ZONE' AND z."isActive" AND (
            (z.area IS NOT NULL AND b.geo IS NOT NULL AND postgis.ST_Covers(z.area, b.geo))
            OR EXISTS (SELECT 1 FROM unnest(z."postalCodePatterns") p
                       WHERE upper(b."postalCode") LIKE replace(replace(replace(upper(p), '%', '\\%'), '_', '\\_'), '*', '%'))))
      OR (a.type = 'RADIUS_KM' AND o.geo IS NOT NULL AND b.geo IS NOT NULL
          AND postgis.ST_DWithin(o.geo, b.geo, (a."radiusKm")::float8 * 1000))
    )`;

/**
 * Vendors that restrict their reach with service areas but do NOT cover this address —
 * these are hidden from the buyer. Vendors without areas never appear here.
 */
export async function excludedVendorIds(addressId: string | null, db: Db = prisma): Promise<string[]> {
  const restricted = await db.vendorServiceArea.findMany({ where: { isActive: true }, distinct: ["vendorCompanyId"], select: { vendorCompanyId: true } });
  if (!restricted.length) return [];
  const ids = restricted.map((r) => r.vendorCompanyId);
  if (!addressId) return ids;
  const covered = await db.$queryRaw<{ id: string }[]>(coveredSql(addressId, ids));
  const ok = new Set(covered.map((c) => c.id));
  return ids.filter((id) => !ok.has(id));
}

/** Does this vendor reach this address? (No active areas → yes.) */
export async function vendorReaches(vendorId: string, addressId: string, db: Db = prisma): Promise<boolean> {
  const n = await db.vendorServiceArea.count({ where: { vendorCompanyId: vendorId, isActive: true } });
  if (n === 0) return true;
  const rows = await db.$queryRaw<{ id: string }[]>(coveredSql(addressId, [vendorId]));
  return rows.length > 0;
}

/** Store a zone's polygon (GeoJSON Polygon / MultiPolygon) as geography; null clears it. */
export async function setZoneArea(zoneId: string, geojson: unknown | null, db: Db = prisma) {
  if (geojson == null) {
    await db.$executeRaw`UPDATE "DeliveryZone" SET area = NULL, polygon = NULL WHERE id = ${zoneId}`;
    return;
  }
  const text = JSON.stringify(geojson);
  await db.$executeRaw`
    UPDATE "DeliveryZone"
    SET area = postgis.ST_Multi(postgis.ST_SetSRID(postgis.ST_GeomFromGeoJSON(${text}), 4326))::postgis.geography,
        polygon = ${text}::jsonb
    WHERE id = ${zoneId}`;
}

/** Checks a GeoJSON shape with PostGIS: must be a valid (Multi)Polygon. Returns its area in km². */
export async function checkPolygon(geojson: unknown, db: Db = prisma): Promise<{ ok: true; km2: number } | { ok: false; error: string }> {
  const g = geojson as { type?: string } | null;
  if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return { ok: false, error: "The shape must be a GeoJSON Polygon or MultiPolygon." };
  try {
    const [r] = await db.$queryRaw<{ valid: boolean; km2: number }[]>`
      SELECT postgis.ST_IsValid(postgis.ST_GeomFromGeoJSON(${JSON.stringify(g)})) AS valid,
             postgis.ST_Area(postgis.ST_SetSRID(postgis.ST_GeomFromGeoJSON(${JSON.stringify(g)}), 4326)::postgis.geography) / 1e6 AS km2`;
    if (!r.valid) return { ok: false, error: "The polygon is not valid (it crosses itself or is not closed)." };
    return { ok: true, km2: Number(r.km2) };
  } catch {
    return { ok: false, error: "This is not valid GeoJSON." };
  }
}
