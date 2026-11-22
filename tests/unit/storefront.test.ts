/** Phase 61: storefront rules (pure). */
import { describe, expect, it } from "vitest";
import { DEFAULT_STOREFRONT_SETTINGS, mergeStorefrontSettings, registerPathFor, slugError, slugify } from "@/lib/storefront";

describe("storefront rules", () => {
  it("link names from company names", () => {
    expect(slugify("Lisboa Central, Lda.")).toBe("lisboa-central");
    expect(slugify("Água & Companhia S.A.")).toBe("agua-companhia");
    expect(slugError(slugify("Ölmühle Großhandel GmbH"))).toBeNull();
    expect(slugify("X").length).toBeGreaterThanOrEqual(3);
  });
  it("link name rules", () => {
    expect(slugError("lisboa-central")).toBeNull();
    expect(slugError("ab")).toBe("LENGTH");
    expect(slugError("Lisboa")).toBe("CHARS");
    expect(slugError("-lisboa")).toBe("CHARS");
    expect(slugError("lis--boa")).toBe("CHARS");
    expect(slugError("admin")).toBe("RESERVED");
  });
  it("settings and who registers where", () => {
    expect(mergeStorefrontSettings(null)).toEqual(DEFAULT_STOREFRONT_SETTINGS);
    expect(mergeStorefrontSettings({ maxFeatured: 99 }).maxFeatured).toBe(24);
    expect(registerPathFor("WHOLESALER")).toBe("customer");
    expect(registerPathFor("DISTRIBUTOR")).toBe("wholesaler");
  });
});
