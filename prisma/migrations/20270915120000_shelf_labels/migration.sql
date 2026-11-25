-- Shelf price labels for shops: products bought on FIRINGI or till items, selling price (by hand or margin), promo,
-- unit-price content, last printed price.
CREATE TABLE "ShelfLabel" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "offerId" TEXT,
    "productId" TEXT,
    "posItemId" TEXT,
    "name" TEXT NOT NULL,
    "barcode" TEXT,
    "brand" TEXT,
    "originCountryCode" TEXT,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "priceGross" DECIMAL(12,2) NOT NULL,
    "marginPct" DECIMAL(6,2),
    "promoPrice" DECIMAL(12,2),
    "promoUntil" TIMESTAMP(3),
    "content" DECIMAL(12,4),
    "contentUnit" TEXT,
    "printedPrice" DECIMAL(12,2),
    "printedPromo" DECIMAL(12,2),
    "printedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShelfLabel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShelfLabel_companyId_offerId_key" ON "ShelfLabel"("companyId", "offerId");
CREATE UNIQUE INDEX "ShelfLabel_companyId_posItemId_key" ON "ShelfLabel"("companyId", "posItemId");
CREATE INDEX "ShelfLabel_companyId_updatedAt_idx" ON "ShelfLabel"("companyId", "updatedAt");
