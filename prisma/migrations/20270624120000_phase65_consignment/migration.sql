-- CreateEnum
CREATE TYPE "ConsignmentStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "ConsignmentCounter" AS ENUM ('CUSTOMER', 'SUPPLIER', 'EITHER');

-- CreateEnum
CREATE TYPE "ConsignmentShipmentStatus" AS ENUM ('SENT', 'RECEIVED');

-- CreateEnum
CREATE TYPE "ConsignmentCountStatus" AS ENUM ('SUBMITTED', 'DISPUTED', 'INVOICED', 'FAILED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "ConsignmentSite" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "ConsignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "countEveryDays" INTEGER NOT NULL DEFAULT 7,
    "counter" "ConsignmentCounter" NOT NULL DEFAULT 'EITHER',
    "note" TEXT,
    "lastCountAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ConsignmentSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsignmentShipment" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "status" "ConsignmentShipmentStatus" NOT NULL DEFAULT 'SENT',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,

    CONSTRAINT "ConsignmentShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsignmentLot" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "batchId" TEXT,
    "lotCode" TEXT,
    "expiresOn" DATE,
    "unitCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "qtySent" INTEGER NOT NULL,
    "qtyShort" INTEGER NOT NULL DEFAULT 0,
    "qtyUsed" INTEGER NOT NULL DEFAULT 0,
    "qtyReturned" INTEGER NOT NULL DEFAULT 0,
    "alertedAt" TIMESTAMP(3),

    CONSTRAINT "ConsignmentLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsignmentCount" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "status" "ConsignmentCountStatus" NOT NULL DEFAULT 'SUBMITTED',
    "countedByCompanyId" TEXT NOT NULL,
    "countedById" TEXT NOT NULL,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lines" JSONB NOT NULL,
    "usedUnits" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "autoConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "disputeNote" TEXT,
    "orderId" TEXT,
    "orderNumber" TEXT,
    "invoiceNumber" TEXT,
    "grossTotal" DECIMAL(18,2),
    "error" TEXT,

    CONSTRAINT "ConsignmentCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsignmentSite_number_key" ON "ConsignmentSite"("number");

-- CreateIndex
CREATE INDEX "ConsignmentSite_vendorCompanyId_status_idx" ON "ConsignmentSite"("vendorCompanyId", "status");

-- CreateIndex
CREATE INDEX "ConsignmentSite_buyerCompanyId_status_idx" ON "ConsignmentSite"("buyerCompanyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ConsignmentShipment_number_key" ON "ConsignmentShipment"("number");

-- CreateIndex
CREATE INDEX "ConsignmentShipment_siteId_status_idx" ON "ConsignmentShipment"("siteId", "status");

-- CreateIndex
CREATE INDEX "ConsignmentLot_siteId_offerId_idx" ON "ConsignmentLot"("siteId", "offerId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsignmentCount_number_key" ON "ConsignmentCount"("number");

-- CreateIndex
CREATE INDEX "ConsignmentCount_siteId_status_idx" ON "ConsignmentCount"("siteId", "status");

-- CreateIndex
CREATE INDEX "ConsignmentCount_status_countedAt_idx" ON "ConsignmentCount"("status", "countedAt");

-- AddForeignKey
ALTER TABLE "ConsignmentShipment" ADD CONSTRAINT "ConsignmentShipment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ConsignmentSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentLot" ADD CONSTRAINT "ConsignmentLot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ConsignmentSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentLot" ADD CONSTRAINT "ConsignmentLot_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "ConsignmentShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentCount" ADD CONSTRAINT "ConsignmentCount_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ConsignmentSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

