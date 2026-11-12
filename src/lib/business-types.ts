/** Business types of customers and categories of their shops (labels: onboarding.businessTypes.*). */
export const BUSINESS_TYPES = ["restaurant", "kebab_pizza", "mini_market", "cafe_bar", "hotel", "catering", "retail", "other"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
export const isBusinessType = (v: unknown): v is BusinessType => typeof v === "string" && (BUSINESS_TYPES as readonly string[]).includes(v);
