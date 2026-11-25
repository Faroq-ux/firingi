-- Marketing catalogues: product catalogues / brochures made by FIRINGI (by hand or with AI), PDF + share link.
CREATE TYPE "MarketingCatalogueScope" AS ENUM ('ALL', 'WHOLESALER', 'ZONE', 'DISTRICT');
CREATE TYPE "MarketingCatalogueStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "MarketingCatalogue" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "intro" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'pt-PT',
    "countryId" TEXT NOT NULL,
    "scope" "MarketingCatalogueScope" NOT NULL DEFAULT 'ALL',
    "scopeIds" TEXT[],
    "filters" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "layout" TEXT NOT NULL DEFAULT 'GRID6',
    "options" JSONB NOT NULL,
    "uploadKey" TEXT,
    "shareToken" TEXT NOT NULL,
    "status" "MarketingCatalogueStatus" NOT NULL DEFAULT 'DRAFT',
    "aiPrompt" TEXT,
    "campaignId" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    CONSTRAINT "MarketingCatalogue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MarketingCatalogue_shareToken_key" ON "MarketingCatalogue"("shareToken");
CREATE INDEX "MarketingCatalogue_status_createdAt_idx" ON "MarketingCatalogue"("status", "createdAt");
