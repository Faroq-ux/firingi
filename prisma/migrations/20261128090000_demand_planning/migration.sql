-- CreateEnum
CREATE TYPE "PlanningMethod" AS ENUM ('AVERAGE', 'HOLT', 'CROSTON', 'SEASONAL');

-- CreateEnum
CREATE TYPE "RestockStatus" AS ENUM ('OPEN', 'ORDERED', 'DISMISSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RestockUrgency" AS ENUM ('OUT', 'LATE', 'ORDER_NOW', 'SOON');

-- AlterTable
ALTER TABLE "PurchaseSupplier" ADD COLUMN     "useMeasuredLeadTime" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "PlanningSettings" (
    "companyId" TEXT NOT NULL,
    "serviceLevel" INTEGER,
    "reviewDays" INTEGER,
    "overstockDays" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "PlanningSettings_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "PlanningItem" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "serviceLevel" INTEGER,
    "leadTimeDays" INTEGER,
    "minOrderQty" INTEGER NOT NULL DEFAULT 1,
    "packMultiple" INTEGER NOT NULL DEFAULT 1,
    "supplierId" TEXT,
    "sellerCompanyId" TEXT,
    "sourceOfferId" TEXT,
    "unitCost" DECIMAL(18,4),
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "PlanningItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemandForecast" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "method" "PlanningMethod" NOT NULL,
    "actual" DOUBLE PRECISION,
    "backtest" BOOLEAN NOT NULL DEFAULT false,
    "madeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestockSuggestion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "status" "RestockStatus" NOT NULL DEFAULT 'OPEN',
    "urgency" "RestockUrgency" NOT NULL,
    "qty" INTEGER NOT NULL,
    "usable" INTEGER NOT NULL,
    "incoming" INTEGER NOT NULL,
    "reorderPoint" INTEGER NOT NULL,
    "orderUpTo" INTEGER NOT NULL,
    "safetyStock" INTEGER NOT NULL,
    "leadTimeDays" INTEGER NOT NULL,
    "dailyDemand" DOUBLE PRECISION NOT NULL,
    "runsOutOn" DATE,
    "orderBy" DATE,
    "supplierId" TEXT,
    "sellerCompanyId" TEXT,
    "sourceOfferId" TEXT,
    "unitCost" DECIMAL(18,4),
    "poId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "dismissReason" TEXT,
    "snoozeUntil" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestockSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "countryId" TEXT,
    "name" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "upliftPct" INTEGER NOT NULL,
    "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "offerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanningEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockRiskDismissal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "until" DATE NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockRiskDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanningItem_offerId_addressId_key" ON "PlanningItem"("offerId", "addressId");

-- CreateIndex
CREATE INDEX "DemandForecast_companyId_weekStart_idx" ON "DemandForecast"("companyId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "DemandForecast_offerId_addressId_weekStart_key" ON "DemandForecast"("offerId", "addressId", "weekStart");

-- CreateIndex
CREATE INDEX "RestockSuggestion_companyId_status_idx" ON "RestockSuggestion"("companyId", "status");

-- CreateIndex
CREATE INDEX "RestockSuggestion_offerId_addressId_status_idx" ON "RestockSuggestion"("offerId", "addressId", "status");

-- CreateIndex
CREATE INDEX "PlanningEvent_companyId_startsOn_idx" ON "PlanningEvent"("companyId", "startsOn");

-- CreateIndex
CREATE UNIQUE INDEX "StockRiskDismissal_companyId_key_key" ON "StockRiskDismissal"("companyId", "key");

-- AddForeignKey
ALTER TABLE "PlanningSettings" ADD CONSTRAINT "PlanningSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningItem" ADD CONSTRAINT "PlanningItem_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "VendorOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningItem" ADD CONSTRAINT "PlanningItem_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningItem" ADD CONSTRAINT "PlanningItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "PurchaseSupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockSuggestion" ADD CONSTRAINT "RestockSuggestion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockSuggestion" ADD CONSTRAINT "RestockSuggestion_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "VendorOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockSuggestion" ADD CONSTRAINT "RestockSuggestion_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningEvent" ADD CONSTRAINT "PlanningEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Phase 30 rules ──────────────────────────────────────────────────────────
ALTER TABLE "PlanningSettings" ADD CONSTRAINT "PlanningSettings_ranges" CHECK (
  ("serviceLevel" IS NULL OR "serviceLevel" BETWEEN 50 AND 99) AND ("reviewDays" IS NULL OR "reviewDays" BETWEEN 1 AND 60)
  AND ("overstockDays" IS NULL OR "overstockDays" BETWEEN 14 AND 365));
ALTER TABLE "PlanningItem" ADD CONSTRAINT "PlanningItem_ranges" CHECK (
  "minOrderQty" >= 1 AND "packMultiple" >= 1 AND ("leadTimeDays" IS NULL OR "leadTimeDays" BETWEEN 0 AND 180)
  AND ("serviceLevel" IS NULL OR "serviceLevel" BETWEEN 50 AND 99) AND ("unitCost" IS NULL OR "unitCost" >= 0)
  AND NOT ("supplierId" IS NOT NULL AND "sellerCompanyId" IS NOT NULL));
ALTER TABLE "DemandForecast" ADD CONSTRAINT "DemandForecast_values" CHECK ("qty" >= 0 AND "low" >= 0 AND "high" >= "qty" AND "low" <= "qty" AND ("actual" IS NULL OR "actual" >= 0));
ALTER TABLE "RestockSuggestion" ADD CONSTRAINT "RestockSuggestion_qty" CHECK ("qty" >= 1);
ALTER TABLE "PlanningEvent" ADD CONSTRAINT "PlanningEvent_ranges" CHECK ("endsOn" >= "startsOn" AND "upliftPct" BETWEEN -90 AND 300);
-- one open suggestion per product × warehouse
CREATE UNIQUE INDEX "RestockSuggestion_one_open" ON "RestockSuggestion" ("offerId", "addressId") WHERE "status" = 'OPEN';

-- FIRINGI-wide demand events (FIRINGI can edit or switch them off)
INSERT INTO "PlanningEvent" ("id", "companyId", "countryId", "name", "startsOn", "endsOn", "upliftPct", "createdById", "updatedAt") VALUES
  ('pev_xmas_2026', NULL, NULL, 'Christmas & New Year', '2026-12-14', '2026-12-31', 35, 'system', now()),
  ('pev_jan_2027', NULL, NULL, 'Quiet January', '2027-01-04', '2027-01-24', -15, 'system', now()),
  ('pev_easter_2027', NULL, NULL, 'Easter', '2027-03-22', '2027-03-28', 20, 'system', now()),
  ('pev_summer_2027', NULL, NULL, 'Summer peak (terraces & tourism)', '2027-07-01', '2027-08-31', 25, 'system', now());
