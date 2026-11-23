-- AlterEnum
ALTER TYPE "PaymentRequestSource" ADD VALUE 'PREORDER';

-- AlterTable
ALTER TABLE "PaymentRequest" ADD COLUMN     "preorderRef" TEXT;

-- CreateTable
CREATE TABLE "PreorderCampaign" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "sellerType" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "deliveryDates" TIMESTAMP(3)[],
    "allocation" TEXT NOT NULL DEFAULT 'PRO_RATA',
    "depositPct" INTEGER NOT NULL DEFAULT 0,
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "allocatedAt" TIMESTAMP(3),
    "announcedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreorderCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreorderItem" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "unitNet" DECIMAL(18,4) NOT NULL,
    "tiers" JSONB NOT NULL DEFAULT '[]',
    "minQty" INTEGER NOT NULL DEFAULT 1,
    "maxQty" INTEGER,
    "supplyQty" INTEGER,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PreorderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreorderReservation" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "deliveryDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLACED',
    "depositAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "depositRequestId" TEXT,
    "note" TEXT,
    "failReason" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "orderIds" TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreorderReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreorderLine" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "allocatedQty" INTEGER,
    "unitNet" DECIMAL(18,4),

    CONSTRAINT "PreorderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceLock" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "unitNet" DECIMAL(18,4) NOT NULL,
    "listUnitNet" DECIMAL(18,4) NOT NULL,
    "qtyTotal" INTEGER NOT NULL,
    "qtyTaken" INTEGER NOT NULL DEFAULT 0,
    "months" INTEGER NOT NULL,
    "validUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "depositPct" INTEGER NOT NULL DEFAULT 0,
    "depositAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "depositRequestId" TEXT,
    "note" TEXT,
    "reviewNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceLockCalloff" (
    "id" TEXT NOT NULL,
    "lockId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceLockCalloff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PreorderCampaign_number_key" ON "PreorderCampaign"("number");

-- CreateIndex
CREATE INDEX "PreorderCampaign_status_countryId_idx" ON "PreorderCampaign"("status", "countryId");

-- CreateIndex
CREATE INDEX "PreorderCampaign_vendorCompanyId_status_idx" ON "PreorderCampaign"("vendorCompanyId", "status");

-- CreateIndex
CREATE INDEX "PreorderItem_campaignId_idx" ON "PreorderItem"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "PreorderReservation_number_key" ON "PreorderReservation"("number");

-- CreateIndex
CREATE INDEX "PreorderReservation_buyerCompanyId_status_idx" ON "PreorderReservation"("buyerCompanyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PreorderReservation_campaignId_buyerCompanyId_key" ON "PreorderReservation"("campaignId", "buyerCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "PreorderLine_reservationId_itemId_key" ON "PreorderLine"("reservationId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceLock_number_key" ON "PriceLock"("number");

-- CreateIndex
CREATE INDEX "PriceLock_buyerCompanyId_status_idx" ON "PriceLock"("buyerCompanyId", "status");

-- CreateIndex
CREATE INDEX "PriceLock_vendorCompanyId_status_idx" ON "PriceLock"("vendorCompanyId", "status");

-- CreateIndex
CREATE INDEX "PriceLockCalloff_lockId_idx" ON "PriceLockCalloff"("lockId");

-- AddForeignKey
ALTER TABLE "PreorderItem" ADD CONSTRAINT "PreorderItem_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "PreorderCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderReservation" ADD CONSTRAINT "PreorderReservation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "PreorderCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderLine" ADD CONSTRAINT "PreorderLine_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "PreorderReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderLine" ADD CONSTRAINT "PreorderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PreorderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceLockCalloff" ADD CONSTRAINT "PriceLockCalloff_lockId_fkey" FOREIGN KEY ("lockId") REFERENCES "PriceLock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

