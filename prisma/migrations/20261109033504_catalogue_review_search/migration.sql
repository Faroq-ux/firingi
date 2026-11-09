-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "searchText" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "VendorOffer" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- CreateIndex
CREATE INDEX "Product_searchText_idx" ON "Product"("searchText");
