-- CreateEnum
CREATE TYPE "CatchWeightMode" AS ENUM ('PIECE', 'KG');

-- CreateEnum
CREATE TYPE "CatchWeightSource" AS ENUM ('PICK', 'SCAN', 'SUPPLIER', 'DRIVER');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "prepayBuffer" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "cwActualKg" DECIMAL(12,3),
ADD COLUMN     "cwBilledKg" DECIMAL(12,3),
ADD COLUMN     "cwMaxOverPct" DECIMAL(5,2),
ADD COLUMN     "cwMode" "CatchWeightMode",
ADD COLUMN     "cwNominalKg" DECIMAL(10,3),
ADD COLUMN     "cwOverAccepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cwWeighedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "VendorOffer" ADD COLUMN     "cwMaxKg" DECIMAL(10,3),
ADD COLUMN     "cwMaxOverPct" DECIMAL(5,2),
ADD COLUMN     "cwMinKg" DECIMAL(10,3),
ADD COLUMN     "cwMode" "CatchWeightMode",
ADD COLUMN     "cwNominalKg" DECIMAL(10,3),
ADD COLUMN     "cwPlu" TEXT;

-- CreateTable
CREATE TABLE "CatchWeighing" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "pieces" JSONB NOT NULL,
    "totalKg" DECIMAL(12,3) NOT NULL,
    "source" "CatchWeightSource" NOT NULL,
    "barcode" TEXT,
    "note" TEXT,
    "byUserId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatchWeighing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatchWeighing_orderLineId_at_idx" ON "CatchWeighing"("orderLineId", "at");

-- AddForeignKey
ALTER TABLE "CatchWeighing" ADD CONSTRAINT "CatchWeighing_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A sold-by-weight offer / line needs a positive weight per unit; limits are sane.
ALTER TABLE "VendorOffer" ADD CONSTRAINT "VendorOffer_cw_check" CHECK (
  "cwMode" IS NULL OR ("cwNominalKg" > 0 AND ("cwMaxOverPct" IS NULL OR "cwMaxOverPct" BETWEEN 0 AND 100)
    AND ("cwMinKg" IS NULL OR "cwMinKg" > 0) AND ("cwMaxKg" IS NULL OR "cwMaxKg" >= COALESCE("cwMinKg", 0))));
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_cw_check" CHECK (
  "cwMode" IS NULL OR ("cwNominalKg" > 0 AND ("cwActualKg" IS NULL OR "cwActualKg" >= 0) AND ("cwBilledKg" IS NULL OR "cwBilledKg" >= 0)));
ALTER TABLE "CatchWeighing" ADD CONSTRAINT "CatchWeighing_total_check" CHECK ("totalKg" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_prepayBuffer_check" CHECK ("prepayBuffer" >= 0);
