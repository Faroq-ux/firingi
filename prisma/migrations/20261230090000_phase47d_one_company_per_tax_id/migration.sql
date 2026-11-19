-- DropIndex
DROP INDEX "Company_countryId_taxId_type_key";

-- CreateIndex
CREATE UNIQUE INDEX "Company_vatNumber_key" ON "Company"("vatNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Company_countryId_taxId_key" ON "Company"("countryId", "taxId");

