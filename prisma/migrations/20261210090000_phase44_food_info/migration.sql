-- CreateEnum
CREATE TYPE "FoodInfoStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "FoodInfoSource" AS ENUM ('MANUAL', 'IMPORT', 'AI');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "foodRequirements" JSONB;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "allergensContain" TEXT[],
ADD COLUMN     "allergensFree" TEXT[],
ADD COLUMN     "allergensMayContain" TEXT[],
ADD COLUMN     "diets" TEXT[],
ADD COLUMN     "foodBlockReason" TEXT,
ADD COLUMN     "foodBlockedAt" TIMESTAMP(3),
ADD COLUMN     "foodInfoId" TEXT;

-- CreateTable
CREATE TABLE "FoodInfo" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "FoodInfoStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "FoodInfoSource" NOT NULL DEFAULT 'MANUAL',
    "allergens" JSONB NOT NULL DEFAULT '{}',
    "allergenDetail" JSONB NOT NULL DEFAULT '{}',
    "ingredients" JSONB NOT NULL DEFAULT '{}',
    "nutrition" JSONB,
    "diets" TEXT[],
    "originCountryCode" TEXT,
    "storage" JSONB NOT NULL DEFAULT '{}',
    "shelfLifeDays" INTEGER,
    "afterOpeningDays" INTEGER,
    "labelKey" TEXT,
    "labelName" TEXT,
    "labelMime" TEXT,
    "specKey" TEXT,
    "specName" TEXT,
    "specMime" TEXT,
    "submittedByCompanyId" TEXT,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "changes" JSONB,
    "aiNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodInfo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodCertificate" (
    "id" TEXT NOT NULL,
    "foodInfoId" TEXT NOT NULL,
    "diet" TEXT NOT NULL,
    "number" TEXT,
    "issuer" TEXT,
    "expiresOn" DATE,
    "fileKey" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "remindedDays" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FoodCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodChange" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "foodInfoId" TEXT NOT NULL,
    "previousId" TEXT,
    "summary" JSONB NOT NULL,
    "allergenAdded" BOOLEAN NOT NULL DEFAULT false,
    "notifiedCompanies" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FoodChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodProfile" (
    "companyId" TEXT NOT NULL,
    "avoid" TEXT[],
    "includeTraces" BOOLEAN NOT NULL DEFAULT true,
    "hideInCatalogue" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodProfile_pkey" PRIMARY KEY ("companyId")
);

-- CreateIndex
CREATE INDEX "FoodInfo_status_submittedAt_idx" ON "FoodInfo"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "FoodInfo_productId_status_idx" ON "FoodInfo"("productId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FoodInfo_productId_version_key" ON "FoodInfo"("productId", "version");

-- CreateIndex
CREATE INDEX "FoodCertificate_expiresOn_idx" ON "FoodCertificate"("expiresOn");

-- CreateIndex
CREATE INDEX "FoodCertificate_foodInfoId_idx" ON "FoodCertificate"("foodInfoId");

-- CreateIndex
CREATE INDEX "FoodChange_productId_createdAt_idx" ON "FoodChange"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "FoodChange_createdAt_idx" ON "FoodChange"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_foodInfoId_key" ON "Product"("foodInfoId");

-- CreateIndex
CREATE INDEX "Product_foodBlockedAt_idx" ON "Product"("foodBlockedAt");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_foodInfoId_fkey" FOREIGN KEY ("foodInfoId") REFERENCES "FoodInfo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodInfo" ADD CONSTRAINT "FoodInfo_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodInfo" ADD CONSTRAINT "FoodInfo_submittedByCompanyId_fkey" FOREIGN KEY ("submittedByCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodCertificate" ADD CONSTRAINT "FoodCertificate_foodInfoId_fkey" FOREIGN KEY ("foodInfoId") REFERENCES "FoodInfo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodChange" ADD CONSTRAINT "FoodChange_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodProfile" ADD CONSTRAINT "FoodProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Phase 44: checks
ALTER TABLE "FoodInfo" ADD CONSTRAINT "FoodInfo_version_check" CHECK ("version" >= 1);
ALTER TABLE "FoodInfo" ADD CONSTRAINT "FoodInfo_shelf_check" CHECK (("shelfLifeDays" IS NULL OR "shelfLifeDays" BETWEEN 1 AND 3650) AND ("afterOpeningDays" IS NULL OR "afterOpeningDays" BETWEEN 1 AND 3650));
ALTER TABLE "FoodInfo" ADD CONSTRAINT "FoodInfo_allergens_obj_check" CHECK (jsonb_typeof("allergens") = 'object' AND jsonb_typeof("ingredients") = 'object' AND jsonb_typeof("storage") = 'object');

-- Phase 44: which food information each category needs (null = inherit; a root with null = not food)
UPDATE "Category" SET "foodRequirements" = '{"fields":["ALLERGENS","INGREDIENTS","NUTRITION","STORAGE"]}' WHERE slug IN ('groceries', 'beverages', 'kebab-pizza-supplies');
UPDATE "Category" SET "foodRequirements" = '{"fields":["ORIGIN"]}' WHERE slug IN ('fresh-produce', 'water');
UPDATE "Category" SET "foodRequirements" = '{"fields":["ALLERGENS"]}' WHERE slug = 'alcoholic-beverages';
UPDATE "Category" SET "foodRequirements" = '{"fields":[]}' WHERE slug = 'pizza-kebab-packaging';
