import "server-only";
/**
 * FIRINGI's search country: the country an admin chose in the top bar. Ctrl+K and every "find a business" box in
 * FIRINGI's pages search only there (or everywhere when "All countries"), always inside the admin's own country /
 * region scope. Kept in a cookie per browser.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { scopeWhere } from "./admin-access";

export const ADMIN_COUNTRY_COOKIE = "firingi_admin_country";

/** The chosen country code, or null for all countries. */
export async function adminSearchCountry(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    const v = (await cookies()).get(ADMIN_COUNTRY_COOKIE)?.value ?? "";
    return /^[A-Z]{2}$/.test(v) ? v : null;
  } catch { return null; } // outside a request (jobs, tests)
}

/** Companies FIRINGI may search: its scope, and the chosen country (or the one asked for). */
export async function adminCompanyWhere(ctx: Ctx, country?: string | null): Promise<Prisma.CompanyWhereInput> {
  const code = country === undefined ? await adminSearchCountry() : country;
  return { AND: [scopeWhere(ctx), code ? { country: { code } } : {}] };
}

/** "Kebab House (PT)" when searching every country; the bare name when one country is chosen. */
export async function countryLabel(rows: { id: string; name: string }[]) {
  if (await adminSearchCountry()) return rows;
  const cos = await prisma.company.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, country: { select: { code: true } } } });
  const m = new Map(cos.map((c) => [c.id, c.country.code]));
  return rows.map((r) => ({ ...r, name: m.get(r.id) ? `${r.name} (${m.get(r.id)})` : r.name }));
}

/** The countries this admin can pick (its scope; else every active Schengen country). */
export async function adminCountryOptions(ctx: Ctx) {
  const ids = ctx.scopes.map((s) => s.countryId).filter((x): x is string => !!x);
  const rows = await prisma.country.findMany({ where: { isActive: true, isSchengen: true, ...(ids.length ? { id: { in: ids } } : {}) }, select: { code: true, name: true }, orderBy: { code: "asc" } });
  const { pickLocalized } = await import("@/i18n/config");
  return rows.map((c) => ({ code: c.code, name: pickLocalized(c.name, "en") }));
}
