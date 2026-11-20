-- AlterEnum (IF NOT EXISTS: safe to run again)
ALTER TYPE "LoyaltyEntryKind" ADD VALUE IF NOT EXISTS 'REDEEM_REWARD';

-- CreateEnum
CREATE TYPE "RewardKind" AS ENUM ('VOUCHER', 'FREE_DELIVERY', 'SUPPLIER_PRODUCT', 'GIFT', 'PARTNER');

-- CreateEnum
CREATE TYPE "RewardStatus" AS ENUM ('DRAFT', 'PENDING', 'ACTIVE', 'PAUSED', 'REJECTED', 'ENDED');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('ISSUED', 'PENDING', 'SHIPPED', 'DELIVERED', 'USED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "LoyaltyAccount" ADD COLUMN     "goalRewardId" TEXT;

-- CreateTable
CREATE TABLE "RewardItem" (
    "id" TEXT NOT NULL,
    "kind" "RewardKind" NOT NULL,
    "status" "RewardStatus" NOT NULL DEFAULT 'DRAFT',
    "title" JSONB NOT NULL,
    "description" JSONB,
    "terms" JSONB,
    "points" INTEGER NOT NULL,
    "stock" INTEGER,
    "perBuyerLimit" INTEGER,
    "minTier" TEXT,
    "buyerTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "countryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "imageKey" TEXT,
    "lowStockSentAt" TIMESTAMP(3),
    "voucherAmount" DECIMAL(10,2),
    "voucherMinOrder" DECIMAL(10,2),
    "voucherDays" INTEGER,
    "supplierCompanyId" TEXT,
    "offerId" TEXT,
    "qty" INTEGER,
    "giftCost" DECIMAL(10,2),
    "partnerName" TEXT,
    "partnerUrl" TEXT,
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardPartnerCode" (
    "id" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "redemptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardPartnerCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRedemption" (
    "id" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "status" "RedemptionStatus" NOT NULL,
    "promotionId" TEXT,
    "couponCode" TEXT,
    "expiresAt" TIMESTAMP(3),
    "partnerCode" TEXT,
    "supplierCompanyId" TEXT,
    "offerId" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "usedQty" INTEGER NOT NULL DEFAULT 0,
    "uses" JSONB NOT NULL DEFAULT '[]',
    "orderId" TEXT,
    "addressId" TEXT,
    "tracking" TEXT,
    "note" TEXT,
    "cancelReason" TEXT,
    "remindedAt" TIMESTAMP(3),
    "fulfilledById" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RewardItem_status_kind_idx" ON "RewardItem"("status", "kind");

-- CreateIndex
CREATE INDEX "RewardItem_supplierCompanyId_idx" ON "RewardItem"("supplierCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardPartnerCode_redemptionId_key" ON "RewardPartnerCode"("redemptionId");

-- CreateIndex
CREATE INDEX "RewardPartnerCode_rewardId_redemptionId_idx" ON "RewardPartnerCode"("rewardId", "redemptionId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardPartnerCode_rewardId_code_key" ON "RewardPartnerCode"("rewardId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRedemption_promotionId_key" ON "RewardRedemption"("promotionId");

-- CreateIndex
CREATE INDEX "RewardRedemption_companyId_createdAt_idx" ON "RewardRedemption"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "RewardRedemption_status_rewardId_idx" ON "RewardRedemption"("status", "rewardId");

-- CreateIndex
CREATE INDEX "RewardRedemption_supplierCompanyId_status_idx" ON "RewardRedemption"("supplierCompanyId", "status");

-- CreateIndex
CREATE INDEX "RewardRedemption_companyId_offerId_status_idx" ON "RewardRedemption"("companyId", "offerId", "status");

-- AddForeignKey
ALTER TABLE "RewardPartnerCode" ADD CONSTRAINT "RewardPartnerCode_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "RewardItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "RewardItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

