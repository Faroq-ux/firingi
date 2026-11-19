-- CreateEnum
CREATE TYPE "FxEventKind" AS ENUM ('MOVE', 'FEED_FAILED', 'STALE', 'OVERRIDE');

-- CreateEnum
CREATE TYPE "FxEntryKind" AS ENUM ('RECEIVABLE', 'PAYABLE');

-- AlterTable
ALTER TABLE "ExchangeRate" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "feedRate" DECIMAL(18,8),
ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "eurRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
ADD COLUMN     "grossTotalLocal" DECIMAL(18,2),
ADD COLUMN     "midRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
ADD COLUMN     "netTotalLocal" DECIMAL(18,2),
ADD COLUMN     "vatTotalLocal" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "lineNetLocal" DECIMAL(18,2),
ADD COLUMN     "lineVatLocal" DECIMAL(18,2),
ADD COLUMN     "unitPriceLocal" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "eurRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
ADD COLUMN     "fxMarginPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
ADD COLUMN     "grandTotalLocal" DECIMAL(18,2),
ADD COLUMN     "midRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
ADD COLUMN     "netTotalLocal" DECIMAL(18,2),
ADD COLUMN     "vatTotalLocal" DECIMAL(18,2),
ADD COLUMN     "vendorRate" DECIMAL(18,8) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "lineNetLocal" DECIMAL(18,2),
ADD COLUMN     "lineVatLocal" DECIMAL(18,2),
ADD COLUMN     "unitPriceLocal" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "amountLocal" DECIMAL(18,2),
ADD COLUMN     "rate" DECIMAL(18,8) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PaymentRequest" ADD COLUMN     "amountLocal" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "VendorBillingStatement" ADD COLUMN     "expectedGrossLocal" DECIMAL(18,2),
ADD COLUMN     "expectedNetLocal" DECIMAL(18,2),
ADD COLUMN     "expectedVatLocal" DECIMAL(18,2),
ADD COLUMN     "rate" DECIMAL(18,8) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "VendorInvoice" ADD COLUMN     "grossTotalLocal" DECIMAL(18,2),
ADD COLUMN     "netTotalLocal" DECIMAL(18,2),
ADD COLUMN     "rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
ADD COLUMN     "vatTotalLocal" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "FxEvent" (
    "id" TEXT NOT NULL,
    "kind" "FxEventKind" NOT NULL,
    "currencyCode" TEXT,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "ackAt" TIMESTAMP(3),
    "ackById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxEntry" (
    "id" TEXT NOT NULL,
    "kind" "FxEntryKind" NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "vendorInvoiceId" TEXT,
    "currencyCode" TEXT NOT NULL,
    "amountLocal" DECIMAL(18,2) NOT NULL,
    "docRate" DECIMAL(18,8) NOT NULL,
    "settleRate" DECIMAL(18,8) NOT NULL,
    "gainLossEur" DECIMAL(18,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FxEvent_kind_createdAt_idx" ON "FxEvent"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "FxEvent_ackAt_idx" ON "FxEvent"("ackAt");

-- CreateIndex
CREATE INDEX "FxEntry_date_idx" ON "FxEntry"("date");

-- CreateIndex
CREATE INDEX "FxEntry_companyId_idx" ON "FxEntry"("companyId");

-- CreateIndex
CREATE INDEX "FxEntry_paymentId_idx" ON "FxEntry"("paymentId");


-- Icelandic króna has no minor unit (ISO 4217)
UPDATE "Currency" SET "decimals" = 0 WHERE "code" = 'ISK';
