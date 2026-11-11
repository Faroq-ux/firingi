-- CreateEnum
CREATE TYPE "PickListStatus" AS ENUM ('OPEN', 'PICKED', 'PACKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecallClass" AS ENUM ('CLASS_I', 'CLASS_II', 'CLASS_III');

-- CreateEnum
CREATE TYPE "RecallStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "RecallRecipientStatus" AS ENUM ('NOTIFIED', 'ACKNOWLEDGED', 'DONE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementType" ADD VALUE 'MOVE';
ALTER TYPE "StockMovementType" ADD VALUE 'RECALL';

-- AlterTable
ALTER TABLE "StockBatch" ADD COLUMN     "binId" TEXT,
ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "recallId" TEXT,
ADD COLUMN     "splitFromId" TEXT;

CREATE INDEX "StockBatch_splitFromId_idx" ON "StockBatch"("splitFromId");

-- CreateTable
CREATE TABLE "Bin" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "zone" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickList" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "PickListStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pickedAt" TIMESTAMP(3),
    "pickedById" TEXT,
    "packedAt" TIMESTAMP(3),
    "packedById" TEXT,

    CONSTRAINT "PickList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickListOrder" (
    "pickListId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "boxes" INTEGER NOT NULL DEFAULT 0,
    "packedAt" TIMESTAMP(3),

    CONSTRAINT "PickListOrder_pkey" PRIMARY KEY ("pickListId","orderId")
);

-- CreateTable
CREATE TABLE "PickLine" (
    "id" TEXT NOT NULL,
    "pickListId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "batchId" TEXT,
    "binCode" TEXT,
    "lotCode" TEXT,
    "expiresOn" DATE,
    "qty" INTEGER NOT NULL,
    "pickedQty" INTEGER NOT NULL DEFAULT 0,
    "shortReason" TEXT,
    "coveredQty" INTEGER NOT NULL DEFAULT 0,
    "pickedAt" TIMESTAMP(3),
    "pickedById" TEXT,
    "verified" TEXT,
    "sortKey" TEXT NOT NULL,

    CONSTRAINT "PickLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recall" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "ownerCompanyId" TEXT NOT NULL,
    "startedByCompanyId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "lotCode" TEXT,
    "expiresOn" DATE,
    "recallClass" "RecallClass" NOT NULL,
    "reason" TEXT NOT NULL,
    "instructions" TEXT,
    "status" "RecallStatus" NOT NULL DEFAULT 'OPEN',
    "blockedUnits" INTEGER NOT NULL DEFAULT 0,
    "reReserved" INTEGER NOT NULL DEFAULT 0,
    "notReReserved" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closeNote" TEXT,

    CONSTRAINT "Recall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecallBatch" (
    "recallId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RecallBatch_pkey" PRIMARY KEY ("recallId","batchId")
);

-- CreateTable
CREATE TABLE "RecallRecipient" (
    "id" TEXT NOT NULL,
    "recallId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "viaCompanyId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "orders" JSONB NOT NULL DEFAULT '[]',
    "status" "RecallRecipientStatus" NOT NULL DEFAULT 'NOTIFIED',
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "returnedQty" INTEGER NOT NULL DEFAULT 0,
    "destroyedQty" INTEGER NOT NULL DEFAULT 0,
    "noneLeft" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "RecallRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bin_addressId_code_key" ON "Bin"("addressId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PickList_number_key" ON "PickList"("number");

-- CreateIndex
CREATE INDEX "PickList_companyId_status_idx" ON "PickList"("companyId", "status");

-- CreateIndex
CREATE INDEX "PickListOrder_orderId_idx" ON "PickListOrder"("orderId");

-- CreateIndex
CREATE INDEX "PickLine_pickListId_sortKey_idx" ON "PickLine"("pickListId", "sortKey");

-- CreateIndex
CREATE UNIQUE INDEX "Recall_number_key" ON "Recall"("number");

-- CreateIndex
CREATE INDEX "Recall_ownerCompanyId_status_idx" ON "Recall"("ownerCompanyId", "status");

-- CreateIndex
CREATE INDEX "RecallRecipient_companyId_status_idx" ON "RecallRecipient"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RecallRecipient_recallId_companyId_key" ON "RecallRecipient"("recallId", "companyId");

-- CreateIndex
CREATE INDEX "StockBatch_binId_idx" ON "StockBatch"("binId");

-- AddForeignKey
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bin" ADD CONSTRAINT "Bin_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bin" ADD CONSTRAINT "Bin_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickList" ADD CONSTRAINT "PickList_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickList" ADD CONSTRAINT "PickList_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickListOrder" ADD CONSTRAINT "PickListOrder_pickListId_fkey" FOREIGN KEY ("pickListId") REFERENCES "PickList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickListOrder" ADD CONSTRAINT "PickListOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickLine" ADD CONSTRAINT "PickLine_pickListId_fkey" FOREIGN KEY ("pickListId") REFERENCES "PickList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recall" ADD CONSTRAINT "Recall_ownerCompanyId_fkey" FOREIGN KEY ("ownerCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallBatch" ADD CONSTRAINT "RecallBatch_recallId_fkey" FOREIGN KEY ("recallId") REFERENCES "Recall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallRecipient" ADD CONSTRAINT "RecallRecipient_recallId_fkey" FOREIGN KEY ("recallId") REFERENCES "Recall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallRecipient" ADD CONSTRAINT "RecallRecipient_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Checks
ALTER TABLE "PickLine" ADD CONSTRAINT "PickLine_qty_check" CHECK ("qty" > 0 AND "pickedQty" >= 0 AND "pickedQty" <= "qty");
ALTER TABLE "PickListOrder" ADD CONSTRAINT "PickListOrder_boxes_check" CHECK ("boxes" >= 0 AND "boxes" <= 999);
ALTER TABLE "RecallRecipient" ADD CONSTRAINT "RecallRecipient_qty_check" CHECK ("qty" >= 0 AND "returnedQty" >= 0 AND "destroyedQty" >= 0);
ALTER TABLE "Bin" ADD CONSTRAINT "Bin_code_check" CHECK (length(trim("code")) > 0);
