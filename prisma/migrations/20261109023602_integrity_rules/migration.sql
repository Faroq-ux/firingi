-- ════════════════════════════════════════════════════════════════════════════
-- FIRINGI integrity rules that must hold even if application code is bypassed.
-- Error messages start with a stable code (e.g. CART_SELLER_MISMATCH) that the
-- application maps to user-friendly messages.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. AUDIT LOG IS APPEND-ONLY ------------------------------------------------
CREATE OR REPLACE FUNCTION firingi_forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % rows cannot be updated or deleted', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION firingi_forbid_change();

CREATE TRIGGER order_status_history_append_only
  BEFORE UPDATE OR DELETE ON "OrderStatusHistory"
  FOR EACH ROW EXECUTE FUNCTION firingi_forbid_change();

CREATE TRIGGER company_status_history_append_only
  BEFORE UPDATE OR DELETE ON "CompanyStatusHistory"
  FOR EACH ROW EXECUTE FUNCTION firingi_forbid_change();

-- 2. VENDOR OFFER sellerType ALWAYS MIRRORS THE VENDOR COMPANY TYPE ----------
--    (the customer-visibility rule filters on sellerType)
CREATE OR REPLACE FUNCTION firingi_offer_seller_type() RETURNS trigger AS $$
DECLARE ctype "CompanyType";
BEGIN
  SELECT "type" INTO ctype FROM "Company" WHERE id = NEW."vendorCompanyId";
  IF ctype IS NULL OR ctype NOT IN ('DISTRIBUTOR', 'WHOLESALER') THEN
    RAISE EXCEPTION 'OFFER_VENDOR_INVALID: company % is not a vendor', NEW."vendorCompanyId"
      USING ERRCODE = 'check_violation';
  END IF;
  NEW."sellerType" := ctype::text::"SellerType";
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER vendor_offer_seller_type
  BEFORE INSERT OR UPDATE ON "VendorOffer"
  FOR EACH ROW EXECUTE FUNCTION firingi_offer_seller_type();

-- A company's type can never change once it is created (prevents a distributor
-- silently becoming a wholesaler and leaking its offers to customers).
CREATE OR REPLACE FUNCTION firingi_company_type_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."type" <> OLD."type" THEN
    RAISE EXCEPTION 'COMPANY_TYPE_IMMUTABLE: company type cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER company_type_immutable
  BEFORE UPDATE OF "type" ON "Company"
  FOR EACH ROW EXECUTE FUNCTION firingi_company_type_immutable();

-- 3. CART IS LOCKED TO ONE SELLER, AND BUYER MAY ONLY BUY FROM ALLOWED SELLER TYPE
CREATE OR REPLACE FUNCTION firingi_cart_item_guard() RETURNS trigger AS $$
DECLARE
  offer_vendor  TEXT;
  offer_seller  "SellerType";
  cart_seller   TEXT;
  buyer_type    "CompanyType";
BEGIN
  SELECT "vendorCompanyId", "sellerType" INTO offer_vendor, offer_seller
    FROM "VendorOffer" WHERE id = NEW."offerId";
  SELECT c."sellerCompanyId", b."type" INTO cart_seller, buyer_type
    FROM "Cart" c JOIN "Company" b ON b.id = c."buyerCompanyId"
   WHERE c.id = NEW."cartId" FOR UPDATE OF c;

  -- Customers buy from wholesalers only; wholesalers buy from distributors only.
  IF NOT ((buyer_type = 'CUSTOMER'   AND offer_seller = 'WHOLESALER') OR
          (buyer_type = 'WHOLESALER' AND offer_seller = 'DISTRIBUTOR')) THEN
    RAISE EXCEPTION 'SELLER_NOT_ALLOWED: % cannot buy from %', buyer_type, offer_seller
      USING ERRCODE = 'check_violation';
  END IF;

  IF cart_seller IS NULL THEN
    UPDATE "Cart" SET "sellerCompanyId" = offer_vendor, "updatedAt" = now() WHERE id = NEW."cartId";
  ELSIF cart_seller <> offer_vendor THEN
    RAISE EXCEPTION 'CART_SELLER_MISMATCH: cart is locked to another vendor'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER cart_item_guard
  BEFORE INSERT OR UPDATE OF "offerId", "cartId" ON "CartItem"
  FOR EACH ROW EXECUTE FUNCTION firingi_cart_item_guard();

-- Unlock the cart when its last item is removed.
CREATE OR REPLACE FUNCTION firingi_cart_unlock() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "CartItem" WHERE "cartId" = OLD."cartId") THEN
    UPDATE "Cart" SET "sellerCompanyId" = NULL, "updatedAt" = now() WHERE id = OLD."cartId";
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER cart_unlock
  AFTER DELETE ON "CartItem"
  FOR EACH ROW EXECUTE FUNCTION firingi_cart_unlock();

ALTER TABLE "CartItem" ADD CONSTRAINT cart_item_qty_positive CHECK (qty > 0);

-- 4. ISSUED INVOICES ARE IMMUTABLE ------------------------------------------
--    Only status (→ PARTIALLY_CREDITED / CREDITED), pdfKey and provider metadata may
--    change after issue. Deletion is never allowed once issued.
CREATE OR REPLACE FUNCTION firingi_invoice_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'INVOICE_IMMUTABLE: issued invoice % cannot be deleted; issue a credit note', OLD."fullNumber"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'DRAFT' AND (
       NEW."docType" IS DISTINCT FROM OLD."docType" OR
       NEW."number" IS DISTINCT FROM OLD."number" OR
       NEW."fullNumber" IS DISTINCT FROM OLD."fullNumber" OR
       NEW."seriesId" IS DISTINCT FROM OLD."seriesId" OR
       NEW."legalEntityId" IS DISTINCT FROM OLD."legalEntityId" OR
       NEW."recipientCompanyId" IS DISTINCT FROM OLD."recipientCompanyId" OR
       NEW."issuerSnapshot" IS DISTINCT FROM OLD."issuerSnapshot" OR
       NEW."recipientSnapshot" IS DISTINCT FROM OLD."recipientSnapshot" OR
       NEW."orderId" IS DISTINCT FROM OLD."orderId" OR
       NEW."netTotal" IS DISTINCT FROM OLD."netTotal" OR
       NEW."vatTotal" IS DISTINCT FROM OLD."vatTotal" OR
       NEW."grossTotal" IS DISTINCT FROM OLD."grossTotal" OR
       NEW."taxRegime" IS DISTINCT FROM OLD."taxRegime" OR
       NEW."currencyCode" IS DISTINCT FROM OLD."currencyCode" OR
       NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt" OR
       NEW."hash" IS DISTINCT FROM OLD."hash" OR
       NEW."atcud" IS DISTINCT FROM OLD."atcud" OR
       NEW.status = 'DRAFT'
     ) THEN
    RAISE EXCEPTION 'INVOICE_IMMUTABLE: issued invoice % cannot be modified', OLD."fullNumber"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_immutable
  BEFORE UPDATE OR DELETE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION firingi_invoice_immutable();

CREATE OR REPLACE FUNCTION firingi_invoice_child_immutable() RETURNS trigger AS $$
DECLARE st "InvoiceStatus";
BEGIN
  SELECT status INTO st FROM "Invoice" WHERE id = COALESCE(NEW."invoiceId", OLD."invoiceId");
  IF st IS NOT NULL AND st <> 'DRAFT' THEN
    RAISE EXCEPTION 'INVOICE_IMMUTABLE: lines of an issued invoice cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_line_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceLine"
  FOR EACH ROW EXECUTE FUNCTION firingi_invoice_child_immutable();
CREATE TRIGGER invoice_tax_summary_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceTaxSummary"
  FOR EACH ROW EXECUTE FUNCTION firingi_invoice_child_immutable();

-- 5. COMMISSION RULES: HISTORY IS NEVER REWRITTEN ---------------------------
--    Only closing a rule (setting validTo) is allowed; delete is forbidden.
CREATE OR REPLACE FUNCTION firingi_commission_rule_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'COMMISSION_HISTORY: commission rules cannot be deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."vendorCompanyId" <> OLD."vendorCompanyId" OR NEW."type" <> OLD."type"
     OR NEW."rate" <> OLD."rate" OR NEW."validFrom" <> OLD."validFrom"
     OR NEW."categoryId" IS DISTINCT FROM OLD."categoryId" THEN
    RAISE EXCEPTION 'COMMISSION_HISTORY: create a new rule instead of editing'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER commission_rule_guard
  BEFORE UPDATE OR DELETE ON "CommissionRule"
  FOR EACH ROW EXECUTE FUNCTION firingi_commission_rule_guard();

ALTER TABLE "CommissionRule" ADD CONSTRAINT commission_rate_non_negative CHECK (rate >= 0);
ALTER TABLE "CommissionRule" ADD CONSTRAINT commission_percent_max
  CHECK (type <> 'PERCENT' OR rate <= 100);

-- 6. PROMOTION FUNDING ------------------------------------------------------
ALTER TABLE "Promotion" ADD CONSTRAINT promotion_funding_sums_to_100
  CHECK ("firingiFundPct" + "vendorFundPct" = 100
         AND "firingiFundPct" >= 0 AND "vendorFundPct" >= 0);
-- Vendor promotions are always fully paid by the vendor.
ALTER TABLE "Promotion" ADD CONSTRAINT vendor_promotion_vendor_funded
  CHECK ("ownerType" <> 'VENDOR' OR ("vendorFundPct" = 100 AND "ownerCompanyId" IS NOT NULL));
ALTER TABLE "Promotion" ADD CONSTRAINT promotion_value_positive CHECK (value > 0);

-- 7. MISC SANITY ------------------------------------------------------------
ALTER TABLE "StockLevel" ADD CONSTRAINT stock_non_negative CHECK ("onHand" >= 0 AND reserved >= 0);
ALTER TABLE "OrderLine"  ADD CONSTRAINT order_line_qty_positive CHECK ("qtyOrdered" > 0);
ALTER TABLE "VendorServiceArea" ADD CONSTRAINT radius_area_complete
  CHECK (type <> 'RADIUS_KM' OR ("originAddressId" IS NOT NULL AND "radiusKm" > 0));

-- At most one default address per company and kind.
CREATE UNIQUE INDEX address_one_default_per_kind
  ON "Address" ("companyId", kind) WHERE "isDefault";
