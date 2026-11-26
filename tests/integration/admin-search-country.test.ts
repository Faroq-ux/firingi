/** FIRINGI's search country: Ctrl+K and "find a business" boxes search only the chosen country, always inside the admin's scope. */
import { describe, expect, it, vi } from "vitest";
import { ctxFor } from "../helpers";

let country: string | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (k === "firingi_admin_country" && country ? { value: country } : undefined) }) }));

describe("admin search country", () => {
  it("all countries: results everywhere with the country shown; one country: only there", async () => {
    const admin = await ctxFor("superadmin@firingi.test");
    const { findBusiness } = await import("@/server/tenders/service");
    const { globalSearch } = await import("@/server/services/search");
    country = null;
    const everywhere = await findBusiness(admin, "Kebab");
    expect(everywhere[0]?.name).toMatch(/\(PT\)$/);
    country = "PT";
    const pt = await findBusiness(admin, "Kebab");
    expect(pt[0]?.name).not.toMatch(/\(PT\)$/);
    country = "ES";
    expect(await findBusiness(admin, "Kebab")).toEqual([]);
    const hits = await globalSearch(admin, "admin", "Kebab");
    expect(hits.filter((h) => h.kind === "company")).toEqual([]);
    country = "PT";
    expect((await globalSearch(admin, "admin", "Kebab")).some((h) => h.kind === "company" && /PT/.test(h.subtitle))).toBe(true);
    country = null;
  });
});
