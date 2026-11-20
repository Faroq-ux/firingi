-- CreateEnum
CREATE TYPE "PayLaterModel" AS ENUM ('PARTNER', 'OWN');

-- CreateEnum
CREATE TYPE "PayLaterStatus" AS ENUM ('ACTIVE', 'INVOICED', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TenderStatus" AS ENUM ('PENDING', 'OPEN', 'CLOSED', 'AWARDED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TenderBidStatus" AS ENUM ('SUBMITTED', 'WITHDRAWN', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "PayLaterPlan" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "model" "PayLaterModel" NOT NULL,
    "term" JSONB NOT NULL,
    "partnerKey" TEXT,
    "partnerRef" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "buyerFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "firingiFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "PayLaterStatus" NOT NULL DEFAULT 'ACTIVE',
    "invoiceId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayLaterPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayLaterInstalment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "overdueAt" TIMESTAMP(3),

    CONSTRAINT "PayLaterInstalment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayLaterAccount" (
    "companyId" TEXT NOT NULL,
    "ownLimit" DECIMAL(18,2),
    "partnerKey" TEXT,
    "partnerStatus" TEXT,
    "partnerLimit" DECIMAL(18,2),
    "partnerRef" TEXT,
    "checkedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayLaterAccount_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "Tender" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "addressId" TEXT NOT NULL,
    "deliveryDate" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3) NOT NULL,
    "status" "TenderStatus" NOT NULL DEFAULT 'OPEN',
    "invitedIds" TEXT[],
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "awardedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderLine" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitNote" TEXT,
    "targetUnitNet" DECIMAL(18,4),
    "awardedBidLineId" TEXT,
    "orderId" TEXT,

    CONSTRAINT "TenderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderBid" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "supplierCompanyId" TEXT NOT NULL,
    "status" "TenderBidStatus" NOT NULL DEFAULT 'SUBMITTED',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenderBid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderBidLine" (
    "id" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "unitNet" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "TenderBidLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayLaterPlan_orderId_key" ON "PayLaterPlan"("orderId");

-- CreateIndex
CREATE INDEX "PayLaterPlan_companyId_status_idx" ON "PayLaterPlan"("companyId", "status");

-- CreateIndex
CREATE INDEX "PayLaterPlan_status_idx" ON "PayLaterPlan"("status");

-- CreateIndex
CREATE INDEX "PayLaterInstalment_dueAt_idx" ON "PayLaterInstalment"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "PayLaterInstalment_planId_n_key" ON "PayLaterInstalment"("planId", "n");

-- CreateIndex
CREATE UNIQUE INDEX "Tender_number_key" ON "Tender"("number");

-- CreateIndex
CREATE INDEX "Tender_status_closesAt_idx" ON "Tender"("status", "closesAt");

-- CreateIndex
CREATE INDEX "Tender_buyerCompanyId_idx" ON "Tender"("buyerCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "TenderLine_awardedBidLineId_key" ON "TenderLine"("awardedBidLineId");

-- CreateIndex
CREATE UNIQUE INDEX "TenderLine_tenderId_n_key" ON "TenderLine"("tenderId", "n");

-- CreateIndex
CREATE UNIQUE INDEX "TenderBid_tenderId_supplierCompanyId_key" ON "TenderBid"("tenderId", "supplierCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "TenderBidLine_bidId_lineId_key" ON "TenderBidLine"("bidId", "lineId");

-- AddForeignKey
ALTER TABLE "PayLaterPlan" ADD CONSTRAINT "PayLaterPlan_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayLaterPlan" ADD CONSTRAINT "PayLaterPlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayLaterInstalment" ADD CONSTRAINT "PayLaterInstalment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PayLaterPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayLaterAccount" ADD CONSTRAINT "PayLaterAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tender" ADD CONSTRAINT "Tender_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tender" ADD CONSTRAINT "Tender_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderLine" ADD CONSTRAINT "TenderLine_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderLine" ADD CONSTRAINT "TenderLine_awardedBidLineId_fkey" FOREIGN KEY ("awardedBidLineId") REFERENCES "TenderBidLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderBid" ADD CONSTRAINT "TenderBid_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderBid" ADD CONSTRAINT "TenderBid_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderBidLine" ADD CONSTRAINT "TenderBidLine_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "TenderBid"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderBidLine" ADD CONSTRAINT "TenderBidLine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "TenderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderBidLine" ADD CONSTRAINT "TenderBidLine_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "VendorOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

