-- CreateEnum
CREATE TYPE "AdPlacement" AS ENUM ('SEARCH', 'CATEGORY', 'HOME', 'CART');

-- CreateEnum
CREATE TYPE "AdPricing" AS ENUM ('CPC', 'DAILY');

-- CreateEnum
CREATE TYPE "AdStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'REJECTED', 'ENDED');

-- CreateEnum
CREATE TYPE "AdBilling" AS ENUM ('PAYOUT', 'PREPAID', 'INVOICE');

-- CreateTable
CREATE TABLE "AdCampaign" (
    "id" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "placement" "AdPlacement" NOT NULL,
    "pricing" "AdPricing" NOT NULL,
    "offerIds" TEXT[],
    "keywords" TEXT[],
    "categoryId" TEXT,
    "cpcBid" DECIMAL(10,2),
    "dailyBudget" DECIMAL(12,2),
    "totalBudget" DECIMAL(12,2),
    "dailyPrice" DECIMAL(10,2),
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "status" "AdStatus" NOT NULL DEFAULT 'PENDING',
    "pausedReason" TEXT,
    "rejectReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdStatDay" (
    "campaignId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "cost" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "AdStatDay_pkey" PRIMARY KEY ("campaignId","day")
);

-- CreateTable
CREATE TABLE "AdCharge" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "day" DATE NOT NULL,
    "buyerCompanyId" TEXT,
    "offerId" TEXT,
    "prepaid" BOOLEAN NOT NULL DEFAULT false,
    "invoiceId" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdAccount" (
    "companyId" TEXT NOT NULL,
    "billing" "AdBilling" NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdAccount_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "AdInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "billing" "AdBilling" NOT NULL,
    "periodStart" DATE,
    "periodEnd" DATE,
    "gross" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdCampaign_status_placement_idx" ON "AdCampaign"("status", "placement");

-- CreateIndex
CREATE INDEX "AdCampaign_vendorCompanyId_idx" ON "AdCampaign"("vendorCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "AdCharge_dedupeKey_key" ON "AdCharge"("dedupeKey");

-- CreateIndex
CREATE INDEX "AdCharge_companyId_invoiceId_idx" ON "AdCharge"("companyId", "invoiceId");

-- CreateIndex
CREATE INDEX "AdCharge_campaignId_buyerCompanyId_createdAt_idx" ON "AdCharge"("campaignId", "buyerCompanyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdInvoice_invoiceId_key" ON "AdInvoice"("invoiceId");

-- CreateIndex
CREATE INDEX "AdInvoice_companyId_idx" ON "AdInvoice"("companyId");

-- AddForeignKey
ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_vendorCompanyId_fkey" FOREIGN KEY ("vendorCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdStatDay" ADD CONSTRAINT "AdStatDay_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AdCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCharge" ADD CONSTRAINT "AdCharge_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AdCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdAccount" ADD CONSTRAINT "AdAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- money rules
ALTER TABLE "AdAccount" ADD CONSTRAINT ad_balance_non_negative CHECK (balance >= 0);
ALTER TABLE "AdCharge" ADD CONSTRAINT ad_charge_positive CHECK (amount > 0);
