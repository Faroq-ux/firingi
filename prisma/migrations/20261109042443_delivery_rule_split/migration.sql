-- Split delivery rules: FIRINGI rule (admin minimum + fee) vs vendor delivery minimum.
ALTER TABLE "DeliveryRule" RENAME COLUMN "freeDeliveryThreshold" TO "vendorDeliveryMinimum";
ALTER TABLE "DeliveryRule" ALTER COLUMN "vendorDeliveryMinimum" DROP NOT NULL;
ALTER TABLE "DeliveryRule" ALTER COLUMN "minOrderValue" DROP NOT NULL;
ALTER TABLE "DeliveryRule" ALTER COLUMN "firingiDeliveryFeeNet" DROP NOT NULL;
ALTER TABLE "DeliveryRule" ALTER COLUMN "feeTaxCategoryId" DROP NOT NULL;
ALTER TABLE "DeliveryRule" ADD COLUMN "updatedById" TEXT;

-- Country rules keep their FIRINGI minimum + fee; the old free-delivery threshold no
-- longer applies at country level (vendors now set their own delivery minimum).
UPDATE "DeliveryRule" SET "vendorDeliveryMinimum" = NULL WHERE scope IN ('COUNTRY', 'ZONE');

ALTER TABLE "DeliveryRule" ADD CONSTRAINT delivery_rule_kind CHECK (
  (scope IN ('COUNTRY', 'ZONE') AND "minOrderValue" IS NOT NULL AND "firingiDeliveryFeeNet" IS NOT NULL AND "feeTaxCategoryId" IS NOT NULL AND "vendorDeliveryMinimum" IS NULL)
  OR
  (scope IN ('VENDOR', 'VENDOR_AREA') AND "vendorCompanyId" IS NOT NULL AND "vendorDeliveryMinimum" IS NOT NULL)
);
ALTER TABLE "DeliveryRule" ADD CONSTRAINT delivery_rule_amounts CHECK (
  coalesce("minOrderValue", 0) >= 0 AND coalesce("firingiDeliveryFeeNet", 0) >= 0 AND coalesce("vendorDeliveryMinimum", 0) >= 0
);
