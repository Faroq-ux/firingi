-- Who sells to whom, enforced in the database (any code path):
--   • customers ← wholesalers of the customer's own country only;
--   • wholesalers ← distributors (anywhere in FIRINGI's European markets);
--   • an offer is always sold from its vendor's country.

-- Offers: country = the vendor's country (set by the database, whatever the caller sends).
CREATE OR REPLACE FUNCTION firingi_offer_seller_type() RETURNS trigger AS $$
DECLARE ctype "CompanyType"; ccountry TEXT;
BEGIN
  SELECT "type", "countryId" INTO ctype, ccountry FROM "Company" WHERE id = NEW."vendorCompanyId";
  IF ctype IS NULL OR ctype NOT IN ('DISTRIBUTOR', 'WHOLESALER') THEN
    RAISE EXCEPTION 'OFFER_VENDOR_INVALID: company % is not a vendor', NEW."vendorCompanyId"
      USING ERRCODE = 'check_violation';
  END IF;
  NEW."sellerType" := ctype::text::"SellerType";
  NEW."countryId" := ccountry;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

UPDATE "VendorOffer" o SET "countryId" = c."countryId"
  FROM "Company" c WHERE c.id = o."vendorCompanyId" AND o."countryId" <> c."countryId";

-- Cart items: seller type per buyer type, and wholesalers only inside the customer's country.
CREATE OR REPLACE FUNCTION firingi_cart_item_guard() RETURNS trigger AS $$
DECLARE
  offer_vendor   TEXT;
  offer_seller   "SellerType";
  vendor_country TEXT;
  cart_seller    TEXT;
  cart_routed    BOOLEAN;
  buyer_type     "CompanyType";
  buyer_country  TEXT;
BEGIN
  SELECT o."vendorCompanyId", o."sellerType", v."countryId" INTO offer_vendor, offer_seller, vendor_country
    FROM "VendorOffer" o JOIN "Company" v ON v.id = o."vendorCompanyId" WHERE o.id = NEW."offerId";
  SELECT c."sellerCompanyId", c."routed", b."type", b."countryId" INTO cart_seller, cart_routed, buyer_type, buyer_country
    FROM "Cart" c JOIN "Company" b ON b.id = c."buyerCompanyId"
   WHERE c.id = NEW."cartId" FOR UPDATE OF c;

  IF NOT ((buyer_type = 'CUSTOMER'   AND offer_seller = 'WHOLESALER') OR
          (buyer_type = 'WHOLESALER' AND offer_seller = 'DISTRIBUTOR')) THEN
    RAISE EXCEPTION 'SELLER_NOT_ALLOWED: % cannot buy from %', buyer_type, offer_seller
      USING ERRCODE = 'check_violation';
  END IF;
  IF offer_seller = 'WHOLESALER' AND vendor_country <> buyer_country THEN
    RAISE EXCEPTION 'SELLER_COUNTRY_NOT_ALLOWED: wholesalers sell only inside their own country'
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

-- Orders: the parties must match the flow (also for orders FIRINGI creates when it moves an order).
CREATE OR REPLACE FUNCTION firingi_order_parties_guard() RETURNS trigger AS $$
DECLARE b_type "CompanyType"; b_country TEXT; s_type "CompanyType"; s_country TEXT;
BEGIN
  SELECT "type", "countryId" INTO b_type, b_country FROM "Company" WHERE id = NEW."buyerCompanyId";
  SELECT "type", "countryId" INTO s_type, s_country FROM "Company" WHERE id = NEW."sellerCompanyId";
  IF NEW.flow = 'CUSTOMER_FROM_WHOLESALER' THEN
    IF b_type <> 'CUSTOMER' OR s_type <> 'WHOLESALER' THEN
      RAISE EXCEPTION 'ORDER_PARTIES_INVALID: customer orders are placed by customers with wholesalers'
        USING ERRCODE = 'check_violation';
    END IF;
    IF b_country <> s_country THEN
      RAISE EXCEPTION 'SELLER_COUNTRY_NOT_ALLOWED: wholesalers sell only inside their own country'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.flow = 'WHOLESALER_FROM_DISTRIBUTOR' THEN
    IF b_type <> 'WHOLESALER' OR s_type <> 'DISTRIBUTOR' THEN
      RAISE EXCEPTION 'ORDER_PARTIES_INVALID: wholesaler orders are placed by wholesalers with distributors'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER order_parties_guard
  BEFORE INSERT OR UPDATE OF "buyerCompanyId", "sellerCompanyId", flow ON "Order"
  FOR EACH ROW EXECUTE FUNCTION firingi_order_parties_guard();
