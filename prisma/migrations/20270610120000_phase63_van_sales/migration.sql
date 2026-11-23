-- CreateEnum
CREATE TYPE "VanLoadStatus" AS ENUM ('OPEN', 'ON_ROAD', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VanPayMethod" AS ENUM ('CASH', 'CARD', 'MB_WAY', 'ON_ACCOUNT');

-- CreateEnum
CREATE TYPE "VanSaleStatus" AS ENUM ('DONE', 'FAILED');

-- AlterEnum
ALTER TYPE "EmptiesSource" ADD VALUE 'VAN';

-- CreateTable
CREATE TABLE "VanLoad" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "sellerUserId" TEXT NOT NULL,
    "status" "VanLoadStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "loadedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "cashExpected" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cashCounted" DECIMAL(18,2),
    "cashVariance" DECIMAL(18,2),
    "closeNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VanLoad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VanLot" (
    "id" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "batchId" TEXT,
    "lotCode" TEXT,
    "expiresOn" DATE,
    "unitCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "qtyLoaded" INTEGER NOT NULL,
    "qtySold" INTEGER NOT NULL DEFAULT 0,
    "qtyBack" INTEGER NOT NULL DEFAULT 0,
    "qtyLost" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VanLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VanSale" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "clientRef" TEXT,
    "status" "VanSaleStatus" NOT NULL DEFAULT 'DONE',
    "error" TEXT,
    "orderId" TEXT,
    "orderNumber" TEXT,
    "invoiceId" TEXT,
    "invoiceNumber" TEXT,
    "method" "VanPayMethod" NOT NULL,
    "grossTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paymentId" TEXT,
    "cashNetted" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "signedBy" TEXT,
    "signatureKey" TEXT,
    "emptiesReturnId" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "note" TEXT,
    "items" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VanSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VanLoad_number_key" ON "VanLoad"("number");

-- CreateIndex
CREATE INDEX "VanLoad_vendorCompanyId_status_idx" ON "VanLoad"("vendorCompanyId", "status");

-- CreateIndex
CREATE INDEX "VanLoad_sellerUserId_status_idx" ON "VanLoad"("sellerUserId", "status");

-- CreateIndex
CREATE INDEX "VanLot_loadId_offerId_idx" ON "VanLot"("loadId", "offerId");

-- CreateIndex
CREATE UNIQUE INDEX "VanSale_number_key" ON "VanSale"("number");

-- CreateIndex
CREATE UNIQUE INDEX "VanSale_clientRef_key" ON "VanSale"("clientRef");

-- CreateIndex
CREATE INDEX "VanSale_loadId_idx" ON "VanSale"("loadId");

-- CreateIndex
CREATE INDEX "VanSale_buyerCompanyId_createdAt_idx" ON "VanSale"("buyerCompanyId", "createdAt");

-- CreateIndex
CREATE INDEX "VanSale_vendorCompanyId_createdAt_idx" ON "VanSale"("vendorCompanyId", "createdAt");

-- AddForeignKey
ALTER TABLE "VanLot" ADD CONSTRAINT "VanLot_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "VanLoad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VanSale" ADD CONSTRAINT "VanSale_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "VanLoad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

