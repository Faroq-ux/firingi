-- CreateEnum
CREATE TYPE "ClaimReason" AS ENUM ('DAMAGED', 'MISSING', 'WRONG_PRODUCT', 'TEMPERATURE', 'SHORT_DATED', 'QUALITY');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ClaimOutcome" AS ENUM ('CREDIT', 'REPLACEMENT');

-- CreateEnum
CREATE TYPE "ClaimFault" AS ENUM ('SUPPLIER', 'DRIVER', 'FIRINGI', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "SupplierClaimResponse" AS ENUM ('ACCEPTED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "ChargebackTarget" AS ENUM ('SUPPLIER', 'DRIVER');

-- CreateEnum
CREATE TYPE "ChargebackStatus" AS ENUM ('OPEN', 'DISPUTED', 'DEDUCTED', 'WAIVED');

-- CreateEnum
CREATE TYPE "QualityAlertKind" AS ENUM ('SUPPLIER_RATE', 'PRODUCT_RATE', 'LOT', 'DRIVER');

-- CreateTable
CREATE TABLE "QualityClaim" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "sellerCompanyId" TEXT NOT NULL,
    "reason" "ClaimReason" NOT NULL,
    "description" TEXT NOT NULL,
    "photoKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredOutcome" "ClaimOutcome" NOT NULL DEFAULT 'CREDIT',
    "status" "ClaimStatus" NOT NULL DEFAULT 'OPEN',
    "dueBy" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "supplierResponse" "SupplierClaimResponse",
    "supplierComment" TEXT,
    "supplierPhotoKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supplierRespondedAt" TIMESTAMP(3),
    "supplierRespondedBy" TEXT,
    "outcome" "ClaimOutcome",
    "fault" "ClaimFault",
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "creditNoteId" TEXT,
    "creditGross" DECIMAL(18,2),
    "creditDeliveryFee" BOOLEAN NOT NULL DEFAULT false,
    "replacementDoneAt" TIMESTAMP(3),
    "replacementById" TEXT,

    CONSTRAINT "QualityClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityClaimLine" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "approvedQty" INTEGER,
    "lotCode" TEXT,

    CONSTRAINT "QualityClaimLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimMessage" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "authorCompanyId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "photoKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimChargeback" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "target" "ChargebackTarget" NOT NULL,
    "vendorCompanyId" TEXT,
    "driverId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "ChargebackStatus" NOT NULL DEFAULT 'OPEN',
    "disputeNote" TEXT,
    "disputedAt" TIMESTAMP(3),
    "disputedById" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "deductedAt" TIMESTAMP(3),
    "deductedRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimChargeback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityAlert" (
    "id" TEXT NOT NULL,
    "kind" "QualityAlertKind" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "companyId" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "claims" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QualityClaim_number_key" ON "QualityClaim"("number");

-- CreateIndex
CREATE INDEX "QualityClaim_status_dueBy_idx" ON "QualityClaim"("status", "dueBy");

-- CreateIndex
CREATE INDEX "QualityClaim_buyerCompanyId_createdAt_idx" ON "QualityClaim"("buyerCompanyId", "createdAt");

-- CreateIndex
CREATE INDEX "QualityClaim_sellerCompanyId_createdAt_idx" ON "QualityClaim"("sellerCompanyId", "createdAt");

-- CreateIndex
CREATE INDEX "QualityClaim_orderId_idx" ON "QualityClaim"("orderId");

-- CreateIndex
CREATE INDEX "QualityClaimLine_claimId_idx" ON "QualityClaimLine"("claimId");

-- CreateIndex
CREATE INDEX "QualityClaimLine_offerId_idx" ON "QualityClaimLine"("offerId");

-- CreateIndex
CREATE INDEX "ClaimMessage_claimId_createdAt_idx" ON "ClaimMessage"("claimId", "createdAt");

-- CreateIndex
CREATE INDEX "ClaimChargeback_target_status_idx" ON "ClaimChargeback"("target", "status");

-- CreateIndex
CREATE INDEX "ClaimChargeback_vendorCompanyId_status_idx" ON "ClaimChargeback"("vendorCompanyId", "status");

-- CreateIndex
CREATE INDEX "ClaimChargeback_driverId_status_idx" ON "ClaimChargeback"("driverId", "status");

-- CreateIndex
CREATE INDEX "QualityAlert_status_kind_idx" ON "QualityAlert"("status", "kind");

-- AddForeignKey
ALTER TABLE "QualityClaim" ADD CONSTRAINT "QualityClaim_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityClaim" ADD CONSTRAINT "QualityClaim_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityClaim" ADD CONSTRAINT "QualityClaim_sellerCompanyId_fkey" FOREIGN KEY ("sellerCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityClaimLine" ADD CONSTRAINT "QualityClaimLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "QualityClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityClaimLine" ADD CONSTRAINT "QualityClaimLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimMessage" ADD CONSTRAINT "ClaimMessage_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "QualityClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimChargeback" ADD CONSTRAINT "ClaimChargeback_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "QualityClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimChargeback" ADD CONSTRAINT "ClaimChargeback_vendorCompanyId_fkey" FOREIGN KEY ("vendorCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimChargeback" ADD CONSTRAINT "ClaimChargeback_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Phase 31 rules ──────────────────────────────────────────────────────────
ALTER TABLE "QualityClaimLine" ADD CONSTRAINT "QualityClaimLine_qty" CHECK ("qty" >= 1 AND ("approvedQty" IS NULL OR ("approvedQty" >= 0 AND "approvedQty" <= "qty")));
ALTER TABLE "ClaimChargeback" ADD CONSTRAINT "ClaimChargeback_target" CHECK ("amount" > 0 AND (("target" = 'SUPPLIER' AND "vendorCompanyId" IS NOT NULL) OR ("target" = 'DRIVER' AND "driverId" IS NOT NULL)));
ALTER TABLE "QualityClaim" ADD CONSTRAINT "QualityClaim_decision" CHECK ("status" IN ('OPEN', 'WITHDRAWN') OR ("decidedAt" IS NOT NULL AND "fault" IS NOT NULL));
CREATE UNIQUE INDEX "QualityAlert_one_open" ON "QualityAlert" ("key") WHERE "status" = 'OPEN';
