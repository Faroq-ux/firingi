-- CreateEnum
CREATE TYPE "LoyaltyTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD');

-- CreateEnum
CREATE TYPE "LoyaltyEntryKind" AS ENUM ('EARN', 'REFERRAL', 'BONUS', 'ADJUST', 'REDEEM_ORDER', 'REDEEM_CREDIT', 'REFUND', 'REVERSE', 'EXPIRE');

-- AlterTable
ALTER TABLE "Cart" ADD COLUMN     "loyaltyPoints" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "LoyaltyAccount" (
    "companyId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarned" INTEGER NOT NULL DEFAULT 0,
    "tier" "LoyaltyTier" NOT NULL DEFAULT 'BRONZE',
    "spend12m" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tierUpdatedAt" TIMESTAMP(3),
    "referralCode" TEXT NOT NULL,
    "referredById" TEXT,
    "referralRewardedAt" TIMESTAMP(3),
    "expiryRemindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyAccount_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "LoyaltyEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "LoyaltyEntryKind" NOT NULL,
    "points" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "euros" DECIMAL(18,2),
    "orderId" TEXT,
    "invoiceId" TEXT,
    "campaignId" TEXT,
    "dedupeKey" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "message" JSONB,
    "multiplier" DECIMAL(6,2) NOT NULL DEFAULT 2,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "vendorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "offerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "LoyaltyCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyAccount_referralCode_key" ON "LoyaltyAccount"("referralCode");

-- CreateIndex
CREATE INDEX "LoyaltyAccount_referredById_idx" ON "LoyaltyAccount"("referredById");

-- CreateIndex
CREATE INDEX "LoyaltyAccount_tier_idx" ON "LoyaltyAccount"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyEntry_dedupeKey_key" ON "LoyaltyEntry"("dedupeKey");

-- CreateIndex
CREATE INDEX "LoyaltyEntry_companyId_createdAt_idx" ON "LoyaltyEntry"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyEntry_companyId_expiresAt_idx" ON "LoyaltyEntry"("companyId", "expiresAt");

-- CreateIndex
CREATE INDEX "LoyaltyEntry_orderId_idx" ON "LoyaltyEntry"("orderId");

-- CreateIndex
CREATE INDEX "LoyaltyEntry_kind_createdAt_idx" ON "LoyaltyEntry"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyCampaign_active_startsAt_endsAt_idx" ON "LoyaltyCampaign"("active", "startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "LoyaltyAccount"("companyId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyEntry" ADD CONSTRAINT "LoyaltyEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "LoyaltyAccount"("companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyEntry" ADD CONSTRAINT "LoyaltyEntry_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "LoyaltyCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A points balance can never go below zero
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "loyalty_balance_nonnegative" CHECK ("balance" >= 0);
ALTER TABLE "LoyaltyEntry" ADD CONSTRAINT "loyalty_remaining_nonnegative" CHECK ("remaining" >= 0);
