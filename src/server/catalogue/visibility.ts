/**
 * THE catalogue visibility rule — every buyer-facing query goes through
 * `visibleOfferWhere`. This is what guarantees, at the data layer, that:
 *   • wholesale customers only ever see wholesalers' offers (never distributors),
 *   • wholesalers only see distributors' offers,
 *   • wholesalers' offers are only visible inside their own country,
 *   • vendors with service areas are only visible where they cover the buyer's address,
 *   • only approved vendors / products and active offers are visible,
 *   • tobacco / alcohol products are hidden unless the buyer holds a valid approval,
 *   • an offer is only visible if the buyer has a price for it,
 *   • offers paused for compliance (a required certificate missing / expired — Phase 28) are hidden,
 *   • food products whose required food information is missing / not approved are hidden while FIRINGI's
 *     "required to sell" switch is on (Product.foodBlockedAt — Phase 44).
 */
import type { CompanyType, Prisma, Restriction, SellerType } from "@prisma/client";

export type BuyerScope = {
  buyerCompanyId: string;
  buyerType: Extract<CompanyType, "CUSTOMER" | "WHOLESALER">;
  buyerCountryId: string;
  allowedRestrictions: Restriction[];
  /** Category ids that are active and not hidden by restriction (see restrictions.ts). */
  browsableCategoryIds: string[];
  /** Vendors whose service areas don't cover the buyer's delivery address (delivery/coverage.ts). */
  excludedVendorIds?: string[];
  /** Category ids whose effective restriction is NOT allowed (for the product-level override check). */
  now?: Date;
};

export const SELLER_FOR_BUYER: Record<BuyerScope["buyerType"], SellerType> = {
  CUSTOMER: "WHOLESALER",
  WHOLESALER: "DISTRIBUTOR",
};

/** Price lists that apply to this buyer (base, its groups, or made for it), currently valid. */
export function applicablePriceListWhere(s: Pick<BuyerScope, "buyerCompanyId">, now = new Date()): Prisma.PriceListWhereInput {
  return {
    isActive: true,
    validFrom: { lte: now },
    AND: [
      { OR: [{ validTo: null }, { validTo: { gt: now } }] },
      {
        OR: [
          { scope: "BASE" },
          { scope: "CUSTOMER_GROUP", targetGroup: { members: { some: { companyId: s.buyerCompanyId } } } },
          { scope: { in: ["CUSTOMER", "CONTRACT"] }, targetCompanyId: s.buyerCompanyId },
        ],
      },
    ],
  };
}

export function visibleOfferWhere(s: BuyerScope): Prisma.VendorOfferWhereInput {
  const seller = SELLER_FOR_BUYER[s.buyerType];
  return {
    status: "ACTIVE",
    compliancePausedAt: null,
    sellerType: seller,
    vendorCompanyId: { not: s.buyerCompanyId, ...(s.excludedVendorIds?.length ? { notIn: s.excludedVendorIds } : {}) },
    // Wholesalers sell only inside their own country; distributors sell EU-wide. Within
    // that, a vendor's service areas narrow where it sells.
    ...(seller === "WHOLESALER" ? { countryId: s.buyerCountryId } : {}),
    vendor: { status: "APPROVED", type: seller, compliancePausedAt: null },
    packaging: {
      isActive: true,
      variant: {
        isActive: true,
        product: {
          status: "APPROVED",
          foodBlockedAt: null,
          categoryId: { in: s.browsableCategoryIds },
          // Product-level restriction (added on top of the category's).
          OR: [{ restriction: null }, { restriction: { in: s.allowedRestrictions } }],
        },
      },
    },
    prices: { some: { priceList: applicablePriceListWhere(s, s.now) } },
  };
}
