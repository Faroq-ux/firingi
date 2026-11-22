/** Wholesaler storefronts (Phase 61) — pure rules shared by the server and the pages. Docs: docs/storefronts.md. */

export type StorefrontSettings = {
  enabled: boolean;
  /** FIRINGI approves a store before it is first published */
  requireApproval: boolean;
  /** visitors who aren't signed in may see a store's products (never prices) */
  publicProducts: boolean;
  maxFeatured: number;
};
export const DEFAULT_STOREFRONT_SETTINGS: StorefrontSettings = { enabled: true, requireApproval: true, publicProducts: true, maxFeatured: 12 };

export function mergeStorefrontSettings(v: Partial<StorefrontSettings> | null | undefined): StorefrontSettings {
  const d = DEFAULT_STOREFRONT_SETTINGS;
  if (!v || typeof v !== "object") return { ...d };
  const n = Math.round(Number(v.maxFeatured));
  return {
    enabled: v.enabled ?? d.enabled,
    requireApproval: v.requireApproval ?? d.requireApproval,
    publicProducts: v.publicProducts ?? d.publicProducts,
    maxFeatured: Number.isFinite(n) ? Math.min(24, Math.max(0, n)) : d.maxFeatured,
  };
}

/** Brand-safe accent colours (readable white text on top, in day and night). */
export const ACCENTS = ["#0d7f8c", "#0f766e", "#1d4ed8", "#4338ca", "#7c3aed", "#be185d", "#b91c1c", "#c2410c", "#a16207", "#15803d", "#334155"] as const;

const RESERVED = new Set(["admin", "api", "buy", "vendor", "driver", "login", "register", "s", "shop", "store", "firingi", "help", "support", "app", "www", "static", "public", "settings", "new"]);

/** A suggested link name from a company name: "Lisboa Central, Lda." → "lisboa-central". */
export function slugify(name: string) {
  const s = name
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(lda|ltd|limited|gmbh|sarl|srl|sa|s\.a|bv|nv|ab|as|oy|sp|zoo|kft|doo|eood|ou|uab|sia|ehf|ag|spa|sas|unipessoal)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s.length >= 3 ? s : `${s || "loja"}-${Math.random().toString(36).slice(2, 6)}`;
}

/** null = fine, otherwise an error key. */
export function slugError(slug: string): "LENGTH" | "CHARS" | "RESERVED" | null {
  if (slug.length < 3 || slug.length > 40) return "LENGTH";
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) || slug.includes("--")) return "CHARS";
  if (RESERVED.has(slug)) return "RESERVED";
  return null;
}

/** Where a visitor registers: customers buy from wholesalers, wholesalers from distributors. */
export const registerPathFor = (storeType: "WHOLESALER" | "DISTRIBUTOR" | string) => (storeType === "DISTRIBUTOR" ? "wholesaler" : "customer");
