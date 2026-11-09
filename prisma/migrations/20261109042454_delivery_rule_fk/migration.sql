-- DropForeignKey
ALTER TABLE "DeliveryRule" DROP CONSTRAINT "DeliveryRule_feeTaxCategoryId_fkey";

-- AddForeignKey
ALTER TABLE "DeliveryRule" ADD CONSTRAINT "DeliveryRule_feeTaxCategoryId_fkey" FOREIGN KEY ("feeTaxCategoryId") REFERENCES "TaxCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

