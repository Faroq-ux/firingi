-- CreateEnum
CREATE TYPE "PosSaleKind" AS ENUM ('SALE', 'REFUND');

-- CreateEnum
CREATE TYPE "PosSaleStatus" AS ENUM ('COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PosFiscalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "PosPaymentMethod" AS ENUM ('CASH', 'CARD', 'MBWAY', 'VOUCHER', 'POINTS', 'OTHER');

-- CreateEnum
CREATE TYPE "PosShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PosCashKind" AS ENUM ('PAY_IN', 'PAY_OUT', 'NO_SALE');

-- CreateTable
CREATE TABLE "PosCompany" (
    "companyId" TEXT NOT NULL,
    "adminState" TEXT NOT NULL DEFAULT 'DEFAULT',
    "receiptHeader" TEXT,
    "receiptFooter" TEXT,
    "loyaltyOn" BOOLEAN NOT NULL DEFAULT false,
    "pointsPerUnit" DECIMAL(10,4) NOT NULL DEFAULT 1,
    "pointValue" DECIMAL(10,4) NOT NULL DEFAULT 0.01,
    "minRedeem" INTEGER NOT NULL DEFAULT 100,
    "discountLimit" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "refundDays" INTEGER NOT NULL DEFAULT 30,
    "emailReceipts" BOOLEAN NOT NULL DEFAULT true,
    "postToAccounting" BOOLEAN NOT NULL DEFAULT true,
    "fiscalProvider" TEXT,
    "fiscalAccount" TEXT,
    "fiscalSecretEnc" TEXT,
    "fiscalSecretHint" TEXT,
    "fiscalTestedAt" TIMESTAMP(3),
    "fiscalTestOk" BOOLEAN,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosCompany_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "PosRegister" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "addressId" TEXT,
    "branchId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "shiftCount" INTEGER NOT NULL DEFAULT 0,
    "lastHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosShift" (
    "id" TEXT NOT NULL,
    "registerId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "PosShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedById" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingFloat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "countedCash" DECIMAL(14,2),
    "expectedCash" DECIMAL(14,2),
    "difference" DECIMAL(14,2),
    "zReport" JSONB,
    "note" TEXT,

    CONSTRAINT "PosShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosCashMove" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "kind" "PosCashKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "byUserId" TEXT NOT NULL,
    "approvedById" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosCashMove_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "barcode" TEXT,
    "plu" TEXT,
    "price" DECIMAL(14,4) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "byWeight" BOOLEAN NOT NULL DEFAULT false,
    "offerId" TEXT,
    "stockPerUnit" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "restriction" TEXT,
    "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "quick" BOOLEAN NOT NULL DEFAULT true,
    "kitchen" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosRecipeLine" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "qty" DECIMAL(12,4) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'PACK',

    CONSTRAINT "PosRecipeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosStockAccrual" (
    "companyId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL DEFAULT '',
    "pending" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "usedTotal" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosStockAccrual_pkey" PRIMARY KEY ("companyId","offerId","addressId")
);

-- CreateTable
CREATE TABLE "PosSale" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "registerId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "PosSaleKind" NOT NULL DEFAULT 'SALE',
    "status" "PosSaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "refundOfId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "net" DECIMAL(14,2) NOT NULL,
    "vat" DECIMAL(14,2) NOT NULL,
    "gross" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cashierId" TEXT NOT NULL,
    "approvedById" TEXT,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "offline" BOOLEAN NOT NULL DEFAULT false,
    "ageChecked" BOOLEAN NOT NULL DEFAULT false,
    "customerTaxId" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "memberId" TEXT,
    "pointsEarned" INTEGER NOT NULL DEFAULT 0,
    "pointsUsed" INTEGER NOT NULL DEFAULT 0,
    "tableRef" TEXT,
    "note" TEXT,
    "fiscalStage" TEXT NOT NULL DEFAULT 'NONFISCAL',
    "fiscalStatus" "PosFiscalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "fiscalProvider" TEXT,
    "fiscalNumber" TEXT,
    "fiscalRef" TEXT,
    "fiscalQr" TEXT,
    "fiscalAttempts" INTEGER NOT NULL DEFAULT 0,
    "fiscalNextAt" TIMESTAMP(3),
    "fiscalError" TEXT,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "receiptToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosSaleLine" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "itemId" TEXT,
    "name" TEXT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "byWeight" BOOLEAN NOT NULL DEFAULT false,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "net" DECIMAL(14,2) NOT NULL,
    "vat" DECIMAL(14,2) NOT NULL,
    "gross" DECIMAL(14,2) NOT NULL,
    "lots" JSONB,

    CONSTRAINT "PosSaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosPayment" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "method" "PosPaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "tendered" DECIMAL(14,2),
    "change" DECIMAL(14,2),
    "ref" TEXT,

    CONSTRAINT "PosPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosOpenTicket" (
    "id" TEXT NOT NULL,
    "registerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "sentLines" INTEGER NOT NULL DEFAULT 0,
    "byUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosOpenTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosMember" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "consentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosPointsEntry" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "saleId" TEXT,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosPointsEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosPin" (
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosPin_pkey" PRIMARY KEY ("companyId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosRegister_companyId_code_key" ON "PosRegister"("companyId", "code");

-- CreateIndex
CREATE INDEX "PosShift_status_idx" ON "PosShift"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PosShift_registerId_number_key" ON "PosShift"("registerId", "number");

-- CreateIndex
CREATE INDEX "PosItem_companyId_active_idx" ON "PosItem"("companyId", "active");

-- CreateIndex
CREATE INDEX "PosItem_companyId_barcode_idx" ON "PosItem"("companyId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "PosRecipeLine_itemId_offerId_key" ON "PosRecipeLine"("itemId", "offerId");

-- CreateIndex
CREATE UNIQUE INDEX "PosSale_receiptToken_key" ON "PosSale"("receiptToken");

-- CreateIndex
CREATE INDEX "PosSale_companyId_soldAt_idx" ON "PosSale"("companyId", "soldAt");

-- CreateIndex
CREATE INDEX "PosSale_fiscalStatus_fiscalNextAt_idx" ON "PosSale"("fiscalStatus", "fiscalNextAt");

-- CreateIndex
CREATE UNIQUE INDEX "PosSale_registerId_clientId_key" ON "PosSale"("registerId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "PosSale_registerId_number_key" ON "PosSale"("registerId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PosMember_companyId_code_key" ON "PosMember"("companyId", "code");

-- AddForeignKey
ALTER TABLE "PosCompany" ADD CONSTRAINT "PosCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosRegister" ADD CONSTRAINT "PosRegister_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "PosRegister"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCashMove" ADD CONSTRAINT "PosCashMove_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "PosShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosItem" ADD CONSTRAINT "PosItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosRecipeLine" ADD CONSTRAINT "PosRecipeLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PosItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "PosRegister"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "PosShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_refundOfId_fkey" FOREIGN KEY ("refundOfId") REFERENCES "PosSale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "PosMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSaleLine" ADD CONSTRAINT "PosSaleLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "PosSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "PosSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOpenTicket" ADD CONSTRAINT "PosOpenTicket_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "PosRegister"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosMember" ADD CONSTRAINT "PosMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPointsEntry" ADD CONSTRAINT "PosPointsEntry_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "PosMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

