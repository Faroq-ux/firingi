-- CreateEnum
CREATE TYPE "AssortmentMode" AS ENUM ('ONLY_LISTED', 'HIDE_LISTED', 'MUST_STOCK');

-- CreateEnum
CREATE TYPE "AssortmentTarget" AS ENUM ('ALL', 'GROUP', 'CUSTOMER');

-- CreateTable
CREATE TABLE "Assortment" (
    "id" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "AssortmentMode" NOT NULL,
    "target" "AssortmentTarget" NOT NULL,
    "targetGroupId" TEXT,
    "targetCompanyId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assortment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssortmentItem" (
    "assortmentId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "mustStock" BOOLEAN NOT NULL DEFAULT false,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssortmentItem_pkey" PRIMARY KEY ("assortmentId","offerId")
);

-- CreateTable
CREATE TABLE "MustStockReminder" (
    "buyerCompanyId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MustStockReminder_pkey" PRIMARY KEY ("buyerCompanyId")
);

-- CreateIndex
CREATE INDEX "Assortment_vendorCompanyId_active_idx" ON "Assortment"("vendorCompanyId", "active");

-- CreateIndex
CREATE INDEX "Assortment_targetCompanyId_idx" ON "Assortment"("targetCompanyId");

-- CreateIndex
CREATE INDEX "Assortment_targetGroupId_idx" ON "Assortment"("targetGroupId");

-- CreateIndex
CREATE INDEX "AssortmentItem_offerId_idx" ON "AssortmentItem"("offerId");

-- AddForeignKey
ALTER TABLE "AssortmentItem" ADD CONSTRAINT "AssortmentItem_assortmentId_fkey" FOREIGN KEY ("assortmentId") REFERENCES "Assortment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

