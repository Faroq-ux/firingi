-- CreateEnum
CREATE TYPE "TradeReturnKind" AS ENUM ('ECSL', 'ARRIVALS', 'DISPATCHES');

-- CreateEnum
CREATE TYPE "TradeReturnStatus" AS ENUM ('OPEN', 'READY', 'FILED');

-- CreateEnum
CREATE TYPE "TradeCodeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- AlterEnum
ALTER TYPE "TaxRegime" ADD VALUE 'INTRA_EU_SUPPLY';

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "cnCode" TEXT,
ADD COLUMN     "suppUnit" TEXT;

-- AlterTable
ALTER TABLE "PackagingUnit" ADD COLUMN     "suppUnits" DECIMAL(12,3);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "cnCheckedAt" TIMESTAMP(3),
ADD COLUMN     "cnCheckedById" TEXT,
ADD COLUMN     "suppUnit" TEXT;

-- AlterTable
ALTER TABLE "VatValidation" ADD COLUMN     "invoiceId" TEXT,
ADD COLUMN     "purpose" TEXT;

-- CreateTable
CREATE TABLE "TradeReturn" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "kind" "TradeReturnKind" NOT NULL,
    "period" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueOn" DATE NOT NULL,
    "status" "TradeReturnStatus" NOT NULL DEFAULT 'OPEN',
    "totalValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalMassKg" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "problemCount" INTEGER NOT NULL DEFAULT 0,
    "correctionCount" INTEGER NOT NULL DEFAULT 0,
    "builtAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "readyById" TEXT,
    "filedAt" TIMESTAMP(3),
    "filedById" TEXT,
    "filingRef" TEXT,
    "note" TEXT,
    "remindedDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeReturnLine" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "partnerCountry" TEXT NOT NULL,
    "partnerVat" TEXT,
    "partnerName" TEXT,
    "partnerCompanyId" TEXT,
    "indicator" TEXT,
    "cnCode" TEXT,
    "description" TEXT,
    "originCountry" TEXT,
    "netMassKg" DECIMAL(18,3),
    "suppQty" DECIMAL(18,3),
    "suppUnit" TEXT,
    "value" DECIMAL(18,2) NOT NULL,
    "natureCode" TEXT,
    "transportMode" TEXT,
    "deliveryTerms" TEXT,
    "correctsPeriod" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceNumber" TEXT,
    "sourceDate" TIMESTAMP(3),
    "orderId" TEXT,
    "productId" TEXT,
    "problems" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "TradeReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeCodeProposal" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "packagingUnitId" TEXT,
    "companyId" TEXT NOT NULL,
    "cnCode" TEXT,
    "netWeightKg" DECIMAL(10,3),
    "suppUnits" DECIMAL(12,3),
    "originCountryCode" TEXT,
    "note" TEXT,
    "status" "TradeCodeStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeCodeProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeReturn_status_dueOn_idx" ON "TradeReturn"("status", "dueOn");

-- CreateIndex
CREATE UNIQUE INDEX "TradeReturn_legalEntityId_kind_period_key" ON "TradeReturn"("legalEntityId", "kind", "period");

-- CreateIndex
CREATE INDEX "TradeReturnLine_returnId_idx" ON "TradeReturnLine"("returnId");

-- CreateIndex
CREATE INDEX "TradeReturnLine_sourceId_idx" ON "TradeReturnLine"("sourceId");

-- CreateIndex
CREATE INDEX "TradeCodeProposal_status_createdAt_idx" ON "TradeCodeProposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TradeCodeProposal_productId_idx" ON "TradeCodeProposal"("productId");

-- CreateIndex
CREATE INDEX "VatValidation_invoiceId_idx" ON "VatValidation"("invoiceId");

-- AddForeignKey
ALTER TABLE "TradeReturn" ADD CONSTRAINT "TradeReturn_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeReturnLine" ADD CONSTRAINT "TradeReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "TradeReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeCodeProposal" ADD CONSTRAINT "TradeCodeProposal_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeCodeProposal" ADD CONSTRAINT "TradeCodeProposal_packagingUnitId_fkey" FOREIGN KEY ("packagingUnitId") REFERENCES "PackagingUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeCodeProposal" ADD CONSTRAINT "TradeCodeProposal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

