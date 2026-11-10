-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('QUEUED', 'SENT', 'SKIPPED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PromotionKind" ADD VALUE 'ORDER_AMOUNT';
ALTER TYPE "PromotionKind" ADD VALUE 'FREE_DELIVERY';
ALTER TYPE "PromotionKind" ADD VALUE 'BUY_X_GET_Y';

-- AlterTable
ALTER TABLE "Cart" ADD COLUMN     "couponCode" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "deliveryDiscountNet" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryPromotionId" TEXT;

-- AlterTable
ALTER TABLE "Promotion" ADD COLUMN     "buyQty" INTEGER,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "description" JSONB,
ADD COLUMN     "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "freeQty" INTEGER,
ADD COLUMN     "maxPerCustomer" INTEGER,
ADD COLUMN     "maxRedemptions" INTEGER,
ADD COLUMN     "showInOffers" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "PromotionTarget" ADD COLUMN     "buyerCompanyId" TEXT,
ADD COLUMN     "crmSegmentId" TEXT;

-- CreateTable
CREATE TABLE "PromotionRedemption" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "code" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "firingiAmount" DECIMAL(18,2) NOT NULL,
    "vendorAmount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "channels" "NotificationChannel"[],
    "audience" JSONB NOT NULL,
    "subject" JSONB NOT NULL,
    "body" JSONB NOT NULL,
    "ctaLabel" JSONB,
    "ctaPath" TEXT,
    "promotionId" TEXT,
    "crmSegmentId" TEXT,
    "waTemplateName" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'QUEUED',
    "skipReason" TEXT,
    "messageId" TEXT,
    "token" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromotionRedemption_buyerCompanyId_idx" ON "PromotionRedemption"("buyerCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionRedemption_promotionId_orderId_key" ON "PromotionRedemption"("promotionId", "orderId");

-- CreateIndex
CREATE INDEX "MarketingCampaign_status_scheduledAt_idx" ON "MarketingCampaign"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_token_key" ON "CampaignRecipient"("token");

-- CreateIndex
CREATE INDEX "CampaignRecipient_companyId_clickedAt_idx" ON "CampaignRecipient"("companyId", "clickedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_userId_channel_key" ON "CampaignRecipient"("campaignId", "userId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_code_key" ON "Promotion"("code");

-- AddForeignKey
ALTER TABLE "PromotionTarget" ADD CONSTRAINT "PromotionTarget_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionTarget" ADD CONSTRAINT "PromotionTarget_crmSegmentId_fkey" FOREIGN KEY ("crmSegmentId") REFERENCES "CrmSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_crmSegmentId_fkey" FOREIGN KEY ("crmSegmentId") REFERENCES "CrmSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Phase 15 integrity rules (kind compared as text: new enum values can't be used in the same transaction)
ALTER TABLE "Promotion" ADD CONSTRAINT promotion_code_format CHECK ("code" IS NULL OR "code" ~ '^[A-Z0-9_-]{3,32}$');
ALTER TABLE "Promotion" ADD CONSTRAINT promotion_free_delivery_funding CHECK ("kind"::text <> 'FREE_DELIVERY' OR "firingiFundPct" IN (0, 100));
ALTER TABLE "Promotion" ADD CONSTRAINT promotion_buy_x_get_y CHECK ("kind"::text <> 'BUY_X_GET_Y' OR ("buyQty" >= 1 AND "freeQty" >= 1));
ALTER TABLE "Promotion" ADD CONSTRAINT promotion_limits_positive CHECK (("maxRedemptions" IS NULL OR "maxRedemptions" >= 1) AND ("maxPerCustomer" IS NULL OR "maxPerCustomer" >= 1));
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT redemption_amounts CHECK ("amount" >= 0 AND "firingiAmount" >= 0 AND "vendorAmount" >= 0 AND "amount" = "firingiAmount" + "vendorAmount");
ALTER TABLE "Order" ADD CONSTRAINT order_delivery_discount_nonnegative CHECK ("deliveryDiscountNet" >= 0);
