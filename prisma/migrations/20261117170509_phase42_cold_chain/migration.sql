-- CreateEnum
CREATE TYPE "TempStage" AS ENUM ('DISPATCH', 'LOADING', 'HANDOVER', 'RECEIPT', 'LOGGER');

-- CreateEnum
CREATE TYPE "TempStatus" AS ENUM ('OK', 'WARN', 'OUT');

-- CreateEnum
CREATE TYPE "ColdIncidentDecision" AS ENUM ('NOTED', 'ACCEPTED', 'REFUSED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ColdEquipmentKind" AS ENUM ('VEHICLE_UNIT', 'COLD_ROOM', 'FREEZER', 'PROBE');

-- CreateEnum
CREATE TYPE "EquipmentLogKind" AS ENUM ('CHECK', 'CLEANING', 'CALIBRATION', 'SERVICE');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "tempClassId" TEXT;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "tempClassId" TEXT;

-- AlterTable
ALTER TABLE "VendorOffer" ADD COLUMN     "tempClassId" TEXT;

-- CreateTable
CREATE TABLE "TempClass" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "minC" DECIMAL(5,1),
    "maxC" DECIMAL(5,1),
    "toleranceC" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "coldChain" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TempClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TempReading" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "deliveryId" TEXT,
    "companyId" TEXT NOT NULL,
    "tempClassId" TEXT,
    "stage" "TempStage" NOT NULL,
    "valueC" DECIMAL(5,1) NOT NULL,
    "status" "TempStatus" NOT NULL,
    "probe" TEXT,
    "supplierName" TEXT,
    "product" TEXT,
    "accepted" BOOLEAN,
    "note" TEXT,
    "vehicleId" TEXT,
    "byUserId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TempReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ColdIncident" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "deliveryId" TEXT,
    "readingId" TEXT,
    "tempClassId" TEXT NOT NULL,
    "stage" "TempStage" NOT NULL,
    "valueC" DECIMAL(5,1) NOT NULL,
    "decision" "ColdIncidentDecision" NOT NULL,
    "fault" TEXT,
    "claimId" TEXT,
    "lines" JSONB,
    "sellerId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "driverId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ColdIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TempLogger" (
    "id" TEXT NOT NULL,
    "ownerCompanyId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "equipmentId" TEXT,
    "tempClassId" TEXT,
    "name" TEXT NOT NULL,
    "serial" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "lastValueC" DECIMAL(5,1),
    "alertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TempLogger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TempLoggerReading" (
    "id" TEXT NOT NULL,
    "loggerId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "valueC" DECIMAL(5,1) NOT NULL,

    CONSTRAINT "TempLoggerReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ColdEquipment" (
    "id" TEXT NOT NULL,
    "ownerCompanyId" TEXT NOT NULL,
    "kind" "ColdEquipmentKind" NOT NULL,
    "name" TEXT NOT NULL,
    "vehicleId" TEXT,
    "tempClassId" TEXT,
    "serial" TEXT,
    "checkEveryDays" INTEGER,
    "cleanEveryDays" INTEGER,
    "calibrateEveryDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ColdEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentLog" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "kind" "EquipmentLogKind" NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "valueC" DECIMAL(5,1),
    "note" TEXT,
    "byUserId" TEXT,
    "doneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TempClass_code_key" ON "TempClass"("code");

-- CreateIndex
CREATE INDEX "TempReading_orderId_stage_idx" ON "TempReading"("orderId", "stage");

-- CreateIndex
CREATE INDEX "TempReading_companyId_at_idx" ON "TempReading"("companyId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "ColdIncident_number_key" ON "ColdIncident"("number");

-- CreateIndex
CREATE INDEX "ColdIncident_sellerId_createdAt_idx" ON "ColdIncident"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "ColdIncident_createdAt_idx" ON "ColdIncident"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TempLogger_tokenHash_key" ON "TempLogger"("tokenHash");

-- CreateIndex
CREATE INDEX "TempLogger_ownerCompanyId_idx" ON "TempLogger"("ownerCompanyId");

-- CreateIndex
CREATE INDEX "TempLogger_vehicleId_idx" ON "TempLogger"("vehicleId");

-- CreateIndex
CREATE INDEX "TempLoggerReading_loggerId_at_idx" ON "TempLoggerReading"("loggerId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "TempLoggerReading_loggerId_at_key" ON "TempLoggerReading"("loggerId", "at");

-- CreateIndex
CREATE INDEX "ColdEquipment_ownerCompanyId_idx" ON "ColdEquipment"("ownerCompanyId");

-- CreateIndex
CREATE INDEX "EquipmentLog_equipmentId_kind_doneAt_idx" ON "EquipmentLog"("equipmentId", "kind", "doneAt");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_tempClassId_fkey" FOREIGN KEY ("tempClassId") REFERENCES "TempClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorOffer" ADD CONSTRAINT "VendorOffer_tempClassId_fkey" FOREIGN KEY ("tempClassId") REFERENCES "TempClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TempReading" ADD CONSTRAINT "TempReading_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TempReading" ADD CONSTRAINT "TempReading_tempClassId_fkey" FOREIGN KEY ("tempClassId") REFERENCES "TempClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ColdIncident" ADD CONSTRAINT "ColdIncident_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ColdIncident" ADD CONSTRAINT "ColdIncident_tempClassId_fkey" FOREIGN KEY ("tempClassId") REFERENCES "TempClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TempLogger" ADD CONSTRAINT "TempLogger_tempClassId_fkey" FOREIGN KEY ("tempClassId") REFERENCES "TempClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TempLoggerReading" ADD CONSTRAINT "TempLoggerReading_loggerId_fkey" FOREIGN KEY ("loggerId") REFERENCES "TempLogger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ColdEquipment" ADD CONSTRAINT "ColdEquipment_tempClassId_fkey" FOREIGN KEY ("tempClassId") REFERENCES "TempClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentLog" ADD CONSTRAINT "EquipmentLog_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "ColdEquipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_tempClassId_fkey" FOREIGN KEY ("tempClassId") REFERENCES "TempClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Readings and ranges are sane.
ALTER TABLE "TempClass" ADD CONSTRAINT "TempClass_range_check" CHECK ("minC" IS NULL OR "maxC" IS NULL OR "minC" <= "maxC");
ALTER TABLE "TempClass" ADD CONSTRAINT "TempClass_tolerance_check" CHECK ("toleranceC" >= 0 AND "toleranceC" <= 10);
ALTER TABLE "TempReading" ADD CONSTRAINT "TempReading_value_check" CHECK ("valueC" BETWEEN -60 AND 80);
ALTER TABLE "TempLoggerReading" ADD CONSTRAINT "TempLoggerReading_value_check" CHECK ("valueC" BETWEEN -60 AND 80);
ALTER TABLE "ColdEquipment" ADD CONSTRAINT "ColdEquipment_days_check" CHECK (COALESCE("checkEveryDays", 1) BETWEEN 1 AND 730 AND COALESCE("cleanEveryDays", 1) BETWEEN 1 AND 730 AND COALESCE("calibrateEveryDays", 1) BETWEEN 1 AND 730);

-- FIRINGI's temperature classes (editable in Catalogue › Temperature Classes).
INSERT INTO "TempClass" (id, code, name, "minC", "maxC", "toleranceC", "coldChain", "sortOrder") VALUES
 ('tc_ambient', 'AMBIENT', '{"en":"Ambient","pt":"Ambiente"}', NULL, 25, 0, false, 0),
 ('tc_chilled', 'CHILLED', '{"en":"Chilled (0–4 °C)","pt":"Refrigerado (0–4 °C)"}', 0, 4, 1, true, 10),
 ('tc_fresh_fish', 'FRESH_FISH', '{"en":"Fresh fish (0–2 °C)","pt":"Peixe fresco (0–2 °C)"}', 0, 2, 1, true, 20),
 ('tc_frozen', 'FROZEN', '{"en":"Frozen (≤ −18 °C)","pt":"Congelado (≤ −18 °C)"}', NULL, -18, 3, true, 30),
 ('tc_deep_frozen', 'DEEP_FROZEN', '{"en":"Deep frozen (≤ −25 °C)","pt":"Ultracongelado (≤ −25 °C)"}', NULL, -25, 3, true, 40);

-- Category defaults (FIRINGI can change them).
UPDATE "Category" SET "tempClassId" = 'tc_chilled' WHERE slug = 'cheese-dairy';
UPDATE "Category" SET "tempClassId" = 'tc_frozen' WHERE slug = 'kebab-meat';
