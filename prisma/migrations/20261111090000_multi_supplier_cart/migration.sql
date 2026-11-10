-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "checkoutId" TEXT;

-- AlterTable
ALTER TABLE "PromotionRedemption" ADD COLUMN     "checkoutId" TEXT;

-- CreateIndex
CREATE INDEX "Order_checkoutId_idx" ON "Order"("checkoutId");


-- One cart, several suppliers (Phase 16): the cart is no longer locked to one vendor.
-- Who may sell to whom is still enforced here.
CREATE OR REPLACE FUNCTION firingi_cart_item_guard() RETURNS trigger AS $$
DECLARE
  offer_seller   "SellerType";
  vendor_country TEXT;
  buyer_type     "CompanyType";
  buyer_country  TEXT;
BEGIN
  SELECT o."sellerType", v."countryId" INTO offer_seller, vendor_country
    FROM "VendorOffer" o JOIN "Company" v ON v.id = o."vendorCompanyId" WHERE o.id = NEW."offerId";
  SELECT b."type", b."countryId" INTO buyer_type, buyer_country
    FROM "Cart" c JOIN "Company" b ON b.id = c."buyerCompanyId" WHERE c.id = NEW."cartId";
  IF NOT ((buyer_type = 'CUSTOMER'   AND offer_seller = 'WHOLESALER') OR
          (buyer_type = 'WHOLESALER' AND offer_seller = 'DISTRIBUTOR')) THEN
    RAISE EXCEPTION 'SELLER_NOT_ALLOWED: % cannot buy from %', buyer_type, offer_seller
      USING ERRCODE = 'check_violation';
  END IF;
  IF offer_seller = 'WHOLESALER' AND vendor_country <> buyer_country THEN
    RAISE EXCEPTION 'SELLER_COUNTRY_NOT_ALLOWED: wholesalers sell only inside their own country'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
UPDATE "Cart" SET "sellerCompanyId" = NULL WHERE "sellerCompanyId" IS NOT NULL;
