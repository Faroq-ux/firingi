-- CreateEnum
CREATE TYPE "StorefrontStatus" AS ENUM ('DRAFT', 'PENDING', 'PUBLISHED', 'SUSPENDED');

-- CreateTable
CREATE TABLE "Storefront" (
    "companyId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "StorefrontStatus" NOT NULL DEFAULT 'DRAFT',
    "tagline" TEXT,
    "about" TEXT,
    "accent" TEXT,
    "logoKey" TEXT,
    "bannerKey" TEXT,
    "featuredOfferIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "showProducts" BOOLEAN NOT NULL DEFAULT true,
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Storefront_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "StorefrontStat" (
    "companyId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "signups" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StorefrontStat_pkey" PRIMARY KEY ("companyId","day")
);

-- CreateTable
CREATE TABLE "StorefrontLink" (
    "buyerCompanyId" TEXT NOT NULL,
    "storeCompanyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorefrontLink_pkey" PRIMARY KEY ("buyerCompanyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Storefront_slug_key" ON "Storefront"("slug");

-- CreateIndex
CREATE INDEX "StorefrontLink_storeCompanyId_idx" ON "StorefrontLink"("storeCompanyId");

-- AddForeignKey
ALTER TABLE "StorefrontStat" ADD CONSTRAINT "StorefrontStat_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Storefront"("companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontLink" ADD CONSTRAINT "StorefrontLink_storeCompanyId_fkey" FOREIGN KEY ("storeCompanyId") REFERENCES "Storefront"("companyId") ON DELETE CASCADE ON UPDATE CASCADE;

