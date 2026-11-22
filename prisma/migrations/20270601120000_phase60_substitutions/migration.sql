-- CreateEnum
CREATE TYPE "SubstitutionMode" AS ENUM ('ASK', 'AUTO', 'NEVER');

-- CreateEnum
CREATE TYPE "SubstitutionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "substituteForLineId" TEXT,
ADD COLUMN     "substitutedQty" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SubstitutionPreference" (
    "companyId" TEXT NOT NULL,
    "mode" "SubstitutionMode" NOT NULL DEFAULT 'ASK',
    "maxPricePct" INTEGER NOT NULL DEFAULT 10,
    "sameBrandOnly" BOOLEAN NOT NULL DEFAULT false,
    "acceptOnTimeout" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubstitutionPreference_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "SubstitutionProductRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mode" "SubstitutionMode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubstitutionProductRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubstituteLink" (
    "id" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "substituteOfferId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubstituteLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Substitution" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "shortQty" INTEGER NOT NULL,
    "substituteOfferId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPriceNet" DECIMAL(18,4) NOT NULL,
    "originalUnitPriceNet" DECIMAL(18,4) NOT NULL,
    "priceMatch" BOOLEAN NOT NULL DEFAULT false,
    "priceDiffPct" DECIMAL(8,2) NOT NULL,
    "sameBrand" BOOLEAN NOT NULL,
    "status" "SubstitutionStatus" NOT NULL DEFAULT 'PENDING',
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "proposedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "newLineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Substitution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubstitutionProductRule_companyId_productId_key" ON "SubstitutionProductRule"("companyId", "productId");

-- CreateIndex
CREATE INDEX "SubstituteLink_vendorCompanyId_idx" ON "SubstituteLink"("vendorCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "SubstituteLink_offerId_substituteOfferId_key" ON "SubstituteLink"("offerId", "substituteOfferId");

-- CreateIndex
CREATE INDEX "Substitution_orderId_idx" ON "Substitution"("orderId");

-- CreateIndex
CREATE INDEX "Substitution_status_expiresAt_idx" ON "Substitution"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "SubstituteLink" ADD CONSTRAINT "SubstituteLink_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "VendorOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstituteLink" ADD CONSTRAINT "SubstituteLink_substituteOfferId_fkey" FOREIGN KEY ("substituteOfferId") REFERENCES "VendorOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Substitution" ADD CONSTRAINT "Substitution_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Substitution" ADD CONSTRAINT "Substitution_substituteOfferId_fkey" FOREIGN KEY ("substituteOfferId") REFERENCES "VendorOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

