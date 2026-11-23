-- CreateTable
CREATE TABLE "PriceBenchmark" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "regionKey" TEXT NOT NULL DEFAULT '',
    "typeKey" TEXT NOT NULL DEFAULT '',
    "buyers" INTEGER NOT NULL,
    "lines" INTEGER NOT NULL,
    "p10" DECIMAL(18,4) NOT NULL,
    "p25" DECIMAL(18,4) NOT NULL,
    "p50" DECIMAL(18,4) NOT NULL,
    "p75" DECIMAL(18,4) NOT NULL,
    "p90" DECIMAL(18,4) NOT NULL,
    "avg" DECIMAL(18,4) NOT NULL,
    "periodDays" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceBenchmark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceBenchmark_countryId_variantId_idx" ON "PriceBenchmark"("countryId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBenchmark_variantId_countryId_regionKey_typeKey_key" ON "PriceBenchmark"("variantId", "countryId", "regionKey", "typeKey");

