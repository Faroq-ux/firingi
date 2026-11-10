-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "RiskReview" AS ENUM ('OPEN', 'CLEARED', 'FRAUD');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'FAILED');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'ON_HOLD';

-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "checkoutId" TEXT,
    "buyerCompanyId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "reasons" JSONB NOT NULL,
    "held" BOOLEAN NOT NULL DEFAULT false,
    "review" "RiskReview" NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "amount" DECIMAL(18,2),
    "companyId" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT,
    "result" JSONB,
    "error" TEXT,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RiskAssessment_orderId_key" ON "RiskAssessment"("orderId");

-- CreateIndex
CREATE INDEX "RiskAssessment_review_level_createdAt_idx" ON "RiskAssessment"("review", "level", "createdAt");

-- CreateIndex
CREATE INDEX "RiskAssessment_buyerCompanyId_idx" ON "RiskAssessment"("buyerCompanyId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_requestedAt_idx" ON "ApprovalRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_kind_status_idx" ON "ApprovalRequest"("kind", "status");

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Phase 16 integrity rules
ALTER TABLE "RiskAssessment" ADD CONSTRAINT risk_score_range CHECK (score >= 0 AND score <= 1000);
-- Four-eyes: the person who decides is never the person who asked.
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT approval_four_eyes CHECK ("decidedById" IS NULL OR "decidedById" <> "requestedById");
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT approval_decided CHECK (status::text IN ('PENDING', 'CANCELLED') OR ("decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL));
