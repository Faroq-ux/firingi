-- CreateEnum
CREATE TYPE "DeliveryMinimumKind" AS ENUM ('AMOUNT', 'UNITS');

-- AlterTable
ALTER TABLE "DeliveryRule" ADD COLUMN     "firingiFreeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "firingiFreeFrom" DECIMAL(18,2),
ADD COLUMN     "vendorFlatFeeNet" DECIMAL(18,2),
ADD COLUMN     "vendorMinimumKind" "DeliveryMinimumKind" NOT NULL DEFAULT 'AMOUNT',
ADD COLUMN     "vendorMinimumUnits" INTEGER;

-- Supplier rules: a minimum by amount OR by units (or only a flat rate); FIRINGI rules: free-from needs the switch's amount.
ALTER TABLE "DeliveryRule" DROP CONSTRAINT delivery_rule_kind;
ALTER TABLE "DeliveryRule" ADD CONSTRAINT delivery_rule_kind CHECK (
  (scope IN ('COUNTRY', 'ZONE') AND "minOrderValue" IS NOT NULL AND "firingiDeliveryFeeNet" IS NOT NULL AND "feeTaxCategoryId" IS NOT NULL
     AND "vendorDeliveryMinimum" IS NULL AND "vendorMinimumUnits" IS NULL AND "vendorFlatFeeNet" IS NULL
     AND (NOT "firingiFreeEnabled" OR "firingiFreeFrom" IS NOT NULL))
  OR
  (scope IN ('VENDOR', 'VENDOR_AREA') AND "vendorCompanyId" IS NOT NULL AND NOT "firingiFreeEnabled" AND "firingiFreeFrom" IS NULL
     AND ("vendorDeliveryMinimum" IS NOT NULL OR "vendorMinimumUnits" IS NOT NULL OR "vendorFlatFeeNet" IS NOT NULL))
);
ALTER TABLE "DeliveryRule" DROP CONSTRAINT delivery_rule_amounts;
ALTER TABLE "DeliveryRule" ADD CONSTRAINT delivery_rule_amounts CHECK (
  coalesce("minOrderValue", 0) >= 0 AND coalesce("firingiDeliveryFeeNet", 0) >= 0 AND coalesce("vendorDeliveryMinimum", 0) >= 0
  AND coalesce("firingiFreeFrom", 0) >= 0 AND coalesce("vendorFlatFeeNet", 0) >= 0 AND coalesce("vendorMinimumUnits", 1) >= 1
);
