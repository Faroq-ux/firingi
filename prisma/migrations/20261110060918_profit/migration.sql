-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('DRIVERS', 'FLEET', 'WAREHOUSE', 'STAFF', 'MARKETING', 'IT', 'PAYMENT_FEES', 'OTHER');

-- CreateEnum
CREATE TYPE "MarginScope" AS ENUM ('GLOBAL', 'COUNTRY', 'CATEGORY', 'VENDOR');

-- CreateTable
CREATE TABLE "CostEntry" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "endDate" DATE,
    "monthly" BOOLEAN NOT NULL DEFAULT false,
    "category" "CostCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amountNet" DECIMAL(18,2) NOT NULL,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "countryId" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarginRule" (
    "id" TEXT NOT NULL,
    "scope" "MarginScope" NOT NULL,
    "countryId" TEXT,
    "categoryId" TEXT,
    "vendorCompanyId" TEXT,
    "minMarginPercent" DECIMAL(6,2) NOT NULL,
    "targetMarginPercent" DECIMAL(6,2),
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarginRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiTarget" (
    "id" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "target" DECIMAL(18,4) NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderRating" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "sellerCompanyId" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "deliveryStars" INTEGER,
    "comment" TEXT,
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostEntry_date_idx" ON "CostEntry"("date");

-- CreateIndex
CREATE INDEX "MarginRule_scope_isActive_idx" ON "MarginRule"("scope", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "KpiTarget_month_metric_key" ON "KpiTarget"("month", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "OrderRating_orderId_key" ON "OrderRating"("orderId");

-- CreateIndex
CREATE INDEX "OrderRating_sellerCompanyId_createdAt_idx" ON "OrderRating"("sellerCompanyId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderRating" ADD CONSTRAINT "OrderRating_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ratings are 1–5; margins are sensible percentages; costs are not negative.
ALTER TABLE "OrderRating" ADD CONSTRAINT order_rating_stars CHECK ("stars" BETWEEN 1 AND 5 AND ("deliveryStars" IS NULL OR "deliveryStars" BETWEEN 1 AND 5));
ALTER TABLE "MarginRule" ADD CONSTRAINT margin_rule_range CHECK ("minMarginPercent" BETWEEN -100 AND 100 AND ("targetMarginPercent" IS NULL OR "targetMarginPercent" >= "minMarginPercent"));
ALTER TABLE "CostEntry" ADD CONSTRAINT cost_entry_amounts CHECK ("amountNet" >= 0 AND "vatAmount" >= 0);
