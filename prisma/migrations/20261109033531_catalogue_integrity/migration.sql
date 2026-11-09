
-- Offers and price lists must be positive / sane.
ALTER TABLE "VendorOffer" ADD CONSTRAINT offer_qty_rules CHECK ("minOrderQty" >= 1 AND "qtyStep" >= 1 AND "leadTimeDays" >= 0);
ALTER TABLE "PriceListItem" ADD CONSTRAINT price_positive CHECK ("unitPriceNet" > 0 AND "minQty" >= 1);
ALTER TABLE "PackagingUnit" ADD CONSTRAINT packaging_units_positive CHECK ("unitsPerPack" >= 1);
-- A price list targets exactly what its scope says.
ALTER TABLE "PriceList" ADD CONSTRAINT price_list_target CHECK (
  (scope = 'BASE' AND "targetGroupId" IS NULL AND "targetCompanyId" IS NULL) OR
  (scope = 'CUSTOMER_GROUP' AND "targetGroupId" IS NOT NULL AND "targetCompanyId" IS NULL) OR
  (scope IN ('CUSTOMER', 'CONTRACT') AND "targetCompanyId" IS NOT NULL AND "targetGroupId" IS NULL)
);
-- Price-list items may only reference the list owner's own offers.
CREATE OR REPLACE FUNCTION firingi_price_item_owner() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "PriceList" pl JOIN "VendorOffer" o ON o."vendorCompanyId" = pl."vendorCompanyId"
     WHERE pl.id = NEW."priceListId" AND o.id = NEW."offerId") THEN
    RAISE EXCEPTION 'PRICE_ITEM_FOREIGN_OFFER: offer does not belong to the price list vendor' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER price_item_owner BEFORE INSERT OR UPDATE ON "PriceListItem"
  FOR EACH ROW EXECUTE FUNCTION firingi_price_item_owner();
