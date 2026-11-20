-- CreateEnum
CREATE TYPE "TradeBonusKind" AS ENUM ('VOLUME', 'FREE_GOODS', 'GROWTH', 'MIX');

-- CreateEnum
CREATE TYPE "TradeBonusPeriod" AS ENUM ('MONTH', 'QUARTER', 'HALF_YEAR', 'YEAR');

-- CreateEnum
CREATE TYPE "TradeBonusStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TradeBonusAudience" AS ENUM ('ALL', 'SEGMENT', 'GROUP', 'COMPANIES');

-- CreateTable
CREATE TABLE "TradeBonus" (
    "id" TEXT NOT NULL,
    "sellerCompanyId" TEXT NOT NULL,
    "fundedBy" TEXT NOT NULL DEFAULT 'SUPPLIER',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "TradeBonusKind" NOT NULL,
    "period" "TradeBonusPeriod" NOT NULL,
    "rules" JSONB NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "audience" "TradeBonusAudience" NOT NULL DEFAULT 'ALL',
    "segmentId" TEXT,
    "groupId" TEXT,
    "companyIds" TEXT[],
    "countries" TEXT[],
    "perShop" BOOLEAN NOT NULL DEFAULT false,
    "offerIds" TEXT[],
    "categoryIds" TEXT[],
    "brandIds" TEXT[],
    "rewardOfferId" TEXT,
    "freeGoodsDays" INTEGER NOT NULL DEFAULT 60,
    "status" "TradeBonusStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeBonus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeBonusSettlement" (
    "id" TEXT NOT NULL,
    "bonusId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL DEFAULT '',
    "periodKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "units" DECIMAL(18,3) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "freeUnits" INTEGER NOT NULL DEFAULT 0,
    "pct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "creditNoteIds" TEXT[],
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeBonusSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeBonusFreeGoods" (
    "id" TEXT NOT NULL,
    "bonusId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL DEFAULT '',
    "offerId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "usedQty" INTEGER NOT NULL DEFAULT 0,
    "periodKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "uses" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeBonusFreeGoods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeBonus_sellerCompanyId_status_idx" ON "TradeBonus"("sellerCompanyId", "status");

-- CreateIndex
CREATE INDEX "TradeBonus_status_validFrom_idx" ON "TradeBonus"("status", "validFrom");

-- CreateIndex
CREATE INDEX "TradeBonusSettlement_companyId_idx" ON "TradeBonusSettlement"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeBonusSettlement_bonusId_companyId_branchId_periodKey_key" ON "TradeBonusSettlement"("bonusId", "companyId", "branchId", "periodKey");

-- CreateIndex
CREATE INDEX "TradeBonusFreeGoods_companyId_offerId_idx" ON "TradeBonusFreeGoods"("companyId", "offerId");

-- AddForeignKey
ALTER TABLE "TradeBonus" ADD CONSTRAINT "TradeBonus_sellerCompanyId_fkey" FOREIGN KEY ("sellerCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeBonusSettlement" ADD CONSTRAINT "TradeBonusSettlement_bonusId_fkey" FOREIGN KEY ("bonusId") REFERENCES "TradeBonus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeBonusFreeGoods" ADD CONSTRAINT "TradeBonusFreeGoods_bonusId_fkey" FOREIGN KEY ("bonusId") REFERENCES "TradeBonus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

