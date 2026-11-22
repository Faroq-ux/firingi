-- CreateEnum
CREATE TYPE "RepVisitStatus" AS ENUM ('PLANNED', 'DONE', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RepVisitOutcome" AS ENUM ('ORDER', 'NO_ORDER', 'FOLLOW_UP', 'CLOSED');

-- CreateEnum
CREATE TYPE "RepOrderStatus" AS ENUM ('PENDING', 'PLACED', 'REJECTED', 'EXPIRED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "salesRepId" TEXT;

-- CreateTable
CREATE TABLE "SalesRep" (
    "id" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "commissionPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "monthlyTarget" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesRep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepAssignment" (
    "id" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepVisit" (
    "id" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "plannedFor" DATE NOT NULL,
    "status" "RepVisitStatus" NOT NULL DEFAULT 'PLANNED',
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "outcome" "RepVisitOutcome",
    "note" TEXT,
    "photoKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "repOrderId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepOrder" (
    "id" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "note" TEXT,
    "status" "RepOrderStatus" NOT NULL DEFAULT 'PENDING',
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "totalNet" DECIMAL(18,2) NOT NULL,
    "orderIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "orderNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepOrderPreference" (
    "buyerCompanyId" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "autoConfirm" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepOrderPreference_pkey" PRIMARY KEY ("buyerCompanyId","vendorCompanyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesRep_vendorCompanyId_userId_key" ON "SalesRep"("vendorCompanyId", "userId");

-- CreateIndex
CREATE INDEX "RepAssignment_repId_idx" ON "RepAssignment"("repId");

-- CreateIndex
CREATE UNIQUE INDEX "RepAssignment_vendorCompanyId_buyerCompanyId_key" ON "RepAssignment"("vendorCompanyId", "buyerCompanyId");

-- CreateIndex
CREATE INDEX "RepVisit_repId_plannedFor_idx" ON "RepVisit"("repId", "plannedFor");

-- CreateIndex
CREATE INDEX "RepVisit_vendorCompanyId_plannedFor_idx" ON "RepVisit"("vendorCompanyId", "plannedFor");

-- CreateIndex
CREATE INDEX "RepOrder_buyerCompanyId_status_idx" ON "RepOrder"("buyerCompanyId", "status");

-- CreateIndex
CREATE INDEX "RepOrder_repId_createdAt_idx" ON "RepOrder"("repId", "createdAt");

-- AddForeignKey
ALTER TABLE "RepAssignment" ADD CONSTRAINT "RepAssignment_repId_fkey" FOREIGN KEY ("repId") REFERENCES "SalesRep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepVisit" ADD CONSTRAINT "RepVisit_repId_fkey" FOREIGN KEY ("repId") REFERENCES "SalesRep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepOrder" ADD CONSTRAINT "RepOrder_repId_fkey" FOREIGN KEY ("repId") REFERENCES "SalesRep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

