-- CreateEnum
CREATE TYPE "EInvoiceDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "EInvoiceKind" AS ENUM ('INVOICE', 'CREDIT_NOTE', 'SERVICE_INVOICE', 'SELF_BILLED', 'SELF_BILLED_CREDIT', 'SUPPLIER_INVOICE');

-- CreateEnum
CREATE TYPE "EInvoiceStatus" AS ENUM ('INVALID', 'QUEUED', 'SENT', 'DELIVERED', 'ACCEPTED', 'REJECTED', 'FAILED', 'RECEIVED', 'MATCHED');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "language" TEXT,
ADD COLUMN     "secondLanguage" TEXT;

-- AlterTable
ALTER TABLE "LegalEntity" ADD COLUMN     "language" TEXT,
ADD COLUMN     "peppolId" TEXT,
ADD COLUMN     "requireOwnLanguage" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "secondLanguage" TEXT;

-- AlterTable
ALTER TABLE "VendorBillingStatement" ADD COLUMN     "selfBilledAt" TIMESTAMP(3),
ADD COLUMN     "selfBilledNumber" TEXT;

-- AlterTable
ALTER TABLE "VendorInvoice" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'UPLOAD';

-- CreateTable
CREATE TABLE "EInvoiceDocument" (
    "id" TEXT NOT NULL,
    "direction" "EInvoiceDirection" NOT NULL,
    "kind" "EInvoiceKind" NOT NULL,
    "status" "EInvoiceStatus" NOT NULL DEFAULT 'QUEUED',
    "invoiceId" TEXT,
    "statementId" TEXT,
    "vendorInvoiceId" TEXT,
    "counterpartyId" TEXT,
    "legalEntityId" TEXT,
    "countryCode" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "language" TEXT,
    "validation" JSONB,
    "xmlKey" TEXT,
    "pdfKey" TEXT,
    "sha256" TEXT,
    "externalId" TEXT,
    "networkRef" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAt" TIMESTAMP(3),
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "responseNote" TEXT,
    "archiveUntil" TIMESTAMP(3),
    "parsed" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EInvoiceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EInvoiceEvent" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" "EInvoiceStatus" NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "actorUserId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EInvoiceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EInvoiceProfile" (
    "companyId" TEXT NOT NULL,
    "delivery" TEXT NOT NULL DEFAULT 'BOTH',
    "peppolId" TEXT,
    "invoiceLanguage" TEXT,
    "secondLanguage" TEXT,
    "ksefNip" TEXT,
    "sdiCode" TEXT,
    "pecEmail" TEXT,
    "leitwegId" TEXT,
    "invoiceEmail" TEXT,
    "selfBilling" BOOLEAN NOT NULL DEFAULT false,
    "selfBillingSince" TIMESTAMP(3),
    "selfBillingAgreement" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EInvoiceProfile_pkey" PRIMARY KEY ("companyId")
);

-- CreateIndex
CREATE INDEX "EInvoiceDocument_status_nextAt_idx" ON "EInvoiceDocument"("status", "nextAt");

-- CreateIndex
CREATE INDEX "EInvoiceDocument_invoiceId_idx" ON "EInvoiceDocument"("invoiceId");

-- CreateIndex
CREATE INDEX "EInvoiceDocument_statementId_idx" ON "EInvoiceDocument"("statementId");

-- CreateIndex
CREATE INDEX "EInvoiceDocument_counterpartyId_createdAt_idx" ON "EInvoiceDocument"("counterpartyId", "createdAt");

-- CreateIndex
CREATE INDEX "EInvoiceDocument_direction_createdAt_idx" ON "EInvoiceDocument"("direction", "createdAt");

-- CreateIndex
CREATE INDEX "EInvoiceDocument_externalId_idx" ON "EInvoiceDocument"("externalId");

-- CreateIndex
CREATE INDEX "EInvoiceEvent_documentId_at_idx" ON "EInvoiceEvent"("documentId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBillingStatement_selfBilledNumber_key" ON "VendorBillingStatement"("selfBilledNumber");

-- AddForeignKey
ALTER TABLE "EInvoiceDocument" ADD CONSTRAINT "EInvoiceDocument_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EInvoiceDocument" ADD CONSTRAINT "EInvoiceDocument_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "VendorBillingStatement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EInvoiceDocument" ADD CONSTRAINT "EInvoiceDocument_vendorInvoiceId_fkey" FOREIGN KEY ("vendorInvoiceId") REFERENCES "VendorInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EInvoiceDocument" ADD CONSTRAINT "EInvoiceDocument_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EInvoiceEvent" ADD CONSTRAINT "EInvoiceEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "EInvoiceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EInvoiceProfile" ADD CONSTRAINT "EInvoiceProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

