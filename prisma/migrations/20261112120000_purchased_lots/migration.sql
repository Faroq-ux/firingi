-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "buyerStockedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PurchasedLot" (
    "id" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "packagingUnitId" TEXT NOT NULL,
    "sellerBatchId" TEXT,
    "lotCode" TEXT,
    "expiresOn" DATE NOT NULL,
    "qty" INTEGER NOT NULL,
    "usedQty" INTEGER NOT NULL DEFAULT 0,
    "ownBatchId" TEXT,
    "stockedAt" TIMESTAMP(3),
    "firstAlertAt" TIMESTAMP(3),
    "secondAlertAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchasedLot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchasedLot_buyerCompanyId_expiresOn_idx" ON "PurchasedLot"("buyerCompanyId", "expiresOn");

-- CreateIndex
CREATE INDEX "PurchasedLot_expiresOn_idx" ON "PurchasedLot"("expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "PurchasedLot_orderId_offerId_sellerBatchId_key" ON "PurchasedLot"("orderId", "offerId", "sellerBatchId");

-- AddForeignKey
ALTER TABLE "PurchasedLot" ADD CONSTRAINT "PurchasedLot_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasedLot" ADD CONSTRAINT "PurchasedLot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "PurchasedLot" ADD CONSTRAINT "purchased_lot_qty" CHECK ("qty" >= 0 AND "usedQty" >= 0 AND "usedQty" <= "qty");
