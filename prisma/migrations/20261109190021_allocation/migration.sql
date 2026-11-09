-- CreateEnum
CREATE TYPE "AllocationTrigger" AS ENUM ('DECLINED', 'SHORTFALL', 'NO_RESPONSE', 'MANUAL');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('MOVED', 'PARTIAL', 'NO_CANDIDATE', 'PENDING', 'DISMISSED', 'FAILED');

-- CreateTable
CREATE TABLE "AllocationEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "trigger" "AllocationTrigger" NOT NULL,
    "status" "AllocationStatus" NOT NULL,
    "automatic" BOOLEAN NOT NULL DEFAULT true,
    "fromVendorId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "candidates" JSONB NOT NULL DEFAULT '[]',
    "newOrders" JSONB NOT NULL DEFAULT '[]',
    "marginOverride" BOOLEAN NOT NULL DEFAULT false,
    "absorbedNet" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "byUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllocationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorAllocationProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "dailyOrderCapacity" INTEGER,
    "note" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorAllocationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AllocationEvent_status_createdAt_idx" ON "AllocationEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AllocationEvent_orderId_idx" ON "AllocationEvent"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorAllocationProfile_companyId_key" ON "VendorAllocationProfile"("companyId");

-- AddForeignKey
ALTER TABLE "AllocationEvent" ADD CONSTRAINT "AllocationEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationEvent" ADD CONSTRAINT "AllocationEvent_fromVendorId_fkey" FOREIGN KEY ("fromVendorId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAllocationProfile" ADD CONSTRAINT "VendorAllocationProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
