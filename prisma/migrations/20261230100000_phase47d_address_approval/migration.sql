-- CreateEnum
CREATE TYPE "AddressChangeAction" AS ENUM ('CREATE', 'UPDATE', 'REMOVE');

-- CreateEnum
CREATE TYPE "AddressChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "AddressChangeRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "addressId" TEXT,
    "action" "AddressChangeAction" NOT NULL,
    "kind" "AddressKind" NOT NULL,
    "data" JSONB NOT NULL,
    "branchId" TEXT,
    "status" "AddressChangeStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "appliedAddressId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AddressChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AddressChangeRequest_status_createdAt_idx" ON "AddressChangeRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AddressChangeRequest_companyId_status_idx" ON "AddressChangeRequest"("companyId", "status");

-- AddForeignKey
ALTER TABLE "AddressChangeRequest" ADD CONSTRAINT "AddressChangeRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

