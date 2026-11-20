-- CreateEnum
CREATE TYPE "Co2ValueStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "co2At" TIMESTAMP(3),
ADD COLUMN     "co2DeliveryKg" DECIMAL(14,3),
ADD COLUMN     "co2PackagingKg" DECIMAL(14,3),
ADD COLUMN     "co2ProductsKg" DECIMAL(14,3),
ADD COLUMN     "distanceKm" DECIMAL(10,1),
ADD COLUMN     "isLocal" BOOLEAN;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "co2Kg" DECIMAL(14,3);

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "fuel" TEXT;

-- CreateTable
CREATE TABLE "Co2CategoryFactor" (
    "categoryId" TEXT NOT NULL,
    "kgPerKg" DECIMAL(10,3) NOT NULL,
    "source" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Co2CategoryFactor_pkey" PRIMARY KEY ("categoryId")
);

-- CreateTable
CREATE TABLE "OfferCo2" (
    "offerId" TEXT NOT NULL,
    "kgPerKg" DECIMAL(10,3),
    "packaging" TEXT,
    "recyclable" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "status" "Co2ValueStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "submittedById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfferCo2_pkey" PRIMARY KEY ("offerId")
);

-- CreateTable
CREATE TABLE "Co2Goal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "reductionPct" DECIMAL(5,2) NOT NULL,
    "createdById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Co2Goal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfferCo2_status_idx" ON "OfferCo2"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Co2Goal_companyId_year_key" ON "Co2Goal"("companyId", "year");

-- AddForeignKey
ALTER TABLE "Co2CategoryFactor" ADD CONSTRAINT "Co2CategoryFactor_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferCo2" ADD CONSTRAINT "OfferCo2_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "VendorOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Co2Goal" ADD CONSTRAINT "Co2Goal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

