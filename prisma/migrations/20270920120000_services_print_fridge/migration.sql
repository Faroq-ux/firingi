-- AlterTable
ALTER TABLE "ServiceType" ADD COLUMN     "allowExtras" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ServiceVisit" ADD COLUMN     "extrasNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "extrasNote" TEXT;

-- CreateTable
CREATE TABLE "PrintProduct" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "labelFormat" TEXT,
    "customSize" JSONB,
    "unitPriceNet" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "setupNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "minQty" INTEGER NOT NULL DEFAULT 1,
    "stepQty" INTEGER NOT NULL DEFAULT 1,
    "priceOnRequest" BOOLEAN NOT NULL DEFAULT false,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 23,
    "turnaroundDays" INTEGER NOT NULL DEFAULT 3,
    "delivery" TEXT[] DEFAULT ARRAY['DELIVERY']::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerCompanyId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "artworkKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "artworkNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "labelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pdfKey" TEXT,
    "delivery" TEXT NOT NULL DEFAULT 'DELIVERY',
    "addressId" TEXT,
    "wantedBy" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "priceNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 23,
    "quoteNote" TEXT,
    "quotedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "readyBy" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "invoicedBy" TEXT NOT NULL DEFAULT 'FIRINGI',
    "providerAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "commissionNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "invoiceId" TEXT,
    "providerInvoiceNo" TEXT,
    "commissionInvoiceId" TEXT,
    "providerPaidAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrintProduct_providerId_active_idx" ON "PrintProduct"("providerId", "active");

-- CreateIndex
CREATE INDEX "PrintProduct_kind_active_idx" ON "PrintProduct"("kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PrintJob_number_key" ON "PrintJob"("number");

-- CreateIndex
CREATE INDEX "PrintJob_customerCompanyId_createdAt_idx" ON "PrintJob"("customerCompanyId", "createdAt");

-- CreateIndex
CREATE INDEX "PrintJob_providerId_status_idx" ON "PrintJob"("providerId", "status");

-- CreateIndex
CREATE INDEX "PrintJob_status_createdAt_idx" ON "PrintJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "PrintProduct" ADD CONSTRAINT "PrintProduct_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PrintProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

