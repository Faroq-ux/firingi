-- CreateEnum
CREATE TYPE "CustomerOrderMode" AS ENUM ('CHOOSE_SUPPLIER', 'FIRINGI');

-- AlterEnum
ALTER TYPE "AllocationStatus" ADD VALUE 'AWAITING_BUYER';

-- AlterTable
ALTER TABLE "Cart" ADD COLUMN     "routed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "isInHouse" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Country" ADD COLUMN     "customerOrderMode" "CustomerOrderMode" NOT NULL DEFAULT 'CHOOSE_SUPPLIER';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "routedByFiringi" BOOLEAN NOT NULL DEFAULT false;

-- FIRINGI-routed carts may hold items from several suppliers (FIRINGI picks at checkout);
-- the seller-type rule (customers ← wholesalers, wholesalers ← distributors) still applies.
CREATE OR REPLACE FUNCTION firingi_cart_item_guard() RETURNS trigger AS $$
DECLARE
  offer_vendor  TEXT;
  offer_seller  "SellerType";
  cart_seller   TEXT;
  cart_routed   BOOLEAN;
  buyer_type    "CompanyType";
BEGIN
  SELECT "vendorCompanyId", "sellerType" INTO offer_vendor, offer_seller
    FROM "VendorOffer" WHERE id = NEW."offerId";
  SELECT c."sellerCompanyId", c."routed", b."type" INTO cart_seller, cart_routed, buyer_type
    FROM "Cart" c JOIN "Company" b ON b.id = c."buyerCompanyId"
   WHERE c.id = NEW."cartId" FOR UPDATE OF c;

  IF NOT ((buyer_type = 'CUSTOMER'   AND offer_seller = 'WHOLESALER') OR
          (buyer_type = 'WHOLESALER' AND offer_seller = 'DISTRIBUTOR')) THEN
    RAISE EXCEPTION 'SELLER_NOT_ALLOWED: % cannot buy from %', buyer_type, offer_seller
      USING ERRCODE = 'check_violation';
  END IF;

  IF cart_routed THEN
    RETURN NEW;
  END IF;
  IF cart_seller IS NULL THEN
    UPDATE "Cart" SET "sellerCompanyId" = offer_vendor, "updatedAt" = now() WHERE id = NEW."cartId";
  ELSIF cart_seller <> offer_vendor THEN
    RAISE EXCEPTION 'CART_SELLER_MISMATCH: cart is locked to another vendor'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
