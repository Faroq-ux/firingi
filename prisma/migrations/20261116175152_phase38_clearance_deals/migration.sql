-- CreateEnum
CREATE TYPE "ClearanceKind" AS ENUM ('FLASH', 'BUNDLE', 'VOLUME', 'LOT', 'BEST_OFFER');

-- CreateEnum
CREATE TYPE "ClearanceStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'ENDED', 'CANCELLED', 'SOLD_OUT');

-- CreateEnum
CREATE TYPE "ClearanceBidStatus" AS ENUM ('PENDING', 'ACCEPTED', 'COUNTERED', 'REJECTED', 'EXPIRED', 'WITHDRAWN', 'ORDERED');

-- CreateEnum
CREATE TYPE "ClearanceWatchKind" AS ENUM ('PRODUCT', 'CATEGORY', 'SUPPLIER');

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "dealBidId" TEXT,
ADD COLUMN     "dealId" TEXT;

-- CreateTable
CREATE TABLE "ClearanceDeal" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "kind" "ClearanceKind" NOT NULL,
    "status" "ClearanceStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT,
    "note" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "maxQty" INTEGER,
    "perBuyerMax" INTEGER,
    "dealPrice" DECIMAL(18,4),
    "bundleQty" INTEGER,
    "bundlePrice" DECIMAL(18,4),
    "tiers" JSONB,
    "lotPrice" DECIMAL(18,4),
    "floorPrice" DECIMAL(18,4),
    "minBidQty" INTEGER,
    "batchId" TEXT,
    "bestBefore" DATE,
    "clearance" BOOLEAN NOT NULL DEFAULT false,
    "clearanceReason" TEXT,
    "commissionPct" DECIMAL(6,3),
    "listPriceAt" DECIMAL(18,4),
    "discountPct" DECIMAL(6,2),
    "autoApproved" BOOLEAN NOT NULL DEFAULT false,
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "alertedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClearanceDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClearanceBid" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "counterPrice" DECIMAL(18,4),
    "status" "ClearanceBidStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClearanceBid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClearanceWatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "kind" "ClearanceWatchKind" NOT NULL,
    "productId" TEXT,
    "categoryId" TEXT,
    "vendorCompanyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClearanceWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClearanceAlert" (
    "id" TEXT NOT NULL,
    "dealId" TEXT,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "day" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClearanceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClearanceDigestOptIn" (
    "userId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClearanceDigestOptIn_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClearanceDeal_number_key" ON "ClearanceDeal"("number");

-- CreateIndex
CREATE INDEX "ClearanceDeal_status_endsAt_idx" ON "ClearanceDeal"("status", "endsAt");

-- CreateIndex
CREATE INDEX "ClearanceDeal_offerId_status_idx" ON "ClearanceDeal"("offerId", "status");

-- CreateIndex
CREATE INDEX "ClearanceDeal_vendorCompanyId_status_idx" ON "ClearanceDeal"("vendorCompanyId", "status");

-- CreateIndex
CREATE INDEX "ClearanceBid_dealId_status_idx" ON "ClearanceBid"("dealId", "status");

-- CreateIndex
CREATE INDEX "ClearanceBid_buyerCompanyId_status_idx" ON "ClearanceBid"("buyerCompanyId", "status");

-- CreateIndex
CREATE INDEX "ClearanceWatch_kind_productId_idx" ON "ClearanceWatch"("kind", "productId");

-- CreateIndex
CREATE INDEX "ClearanceWatch_kind_categoryId_idx" ON "ClearanceWatch"("kind", "categoryId");

-- CreateIndex
CREATE INDEX "ClearanceWatch_kind_vendorCompanyId_idx" ON "ClearanceWatch"("kind", "vendorCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "ClearanceWatch_userId_kind_productId_categoryId_vendorCompa_key" ON "ClearanceWatch"("userId", "kind", "productId", "categoryId", "vendorCompanyId");

-- CreateIndex
CREATE INDEX "ClearanceAlert_userId_createdAt_idx" ON "ClearanceAlert"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClearanceAlert_dealId_userId_reason_key" ON "ClearanceAlert"("dealId", "userId", "reason");

-- CreateIndex
CREATE UNIQUE INDEX "ClearanceAlert_userId_reason_day_key" ON "ClearanceAlert"("userId", "reason", "day");

-- CreateIndex
CREATE INDEX "OrderLine_dealId_idx" ON "OrderLine"("dealId");

-- AddForeignKey
ALTER TABLE "ClearanceDeal" ADD CONSTRAINT "ClearanceDeal_vendorCompanyId_fkey" FOREIGN KEY ("vendorCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearanceDeal" ADD CONSTRAINT "ClearanceDeal_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "VendorOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearanceBid" ADD CONSTRAINT "ClearanceBid_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "ClearanceDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearanceBid" ADD CONSTRAINT "ClearanceBid_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "ClearanceDeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
