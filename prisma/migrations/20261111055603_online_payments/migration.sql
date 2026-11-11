-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('OPEN', 'PROCESSING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentRequestSource" AS ENUM ('BUYER', 'STAFF', 'REMINDER', 'DIRECT_DEBIT', 'ORDER');

-- CreateEnum
CREATE TYPE "MandateStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED', 'FAILED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "payBeforeShipping" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "awaitingPayment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "provider" TEXT,
ADD COLUMN     "refundedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'OPEN',
    "source" "PaymentRequestSource" NOT NULL,
    "provider" TEXT,
    "method" "PaymentMethod",
    "providerRef" TEXT,
    "providerPaymentRef" TEXT,
    "action" JSONB,
    "mandateId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paidAmount" DECIMAL(18,2),
    "paymentId" TEXT,
    "failureReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "PaymentRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SepaMandate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "MandateStatus" NOT NULL DEFAULT 'PENDING',
    "holderName" TEXT,
    "ibanLast4" TEXT,
    "providerCustomerRef" TEXT,
    "providerMandateRef" TEXT,
    "providerPaymentMethodRef" TEXT,
    "setupRef" TEXT,
    "autoCollect" BOOLEAN NOT NULL DEFAULT true,
    "signedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SepaMandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceReminder" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_token_key" ON "PaymentRequest"("token");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_paymentId_key" ON "PaymentRequest"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentRequest_companyId_status_idx" ON "PaymentRequest"("companyId", "status");

-- CreateIndex
CREATE INDEX "PaymentRequest_status_expiresAt_idx" ON "PaymentRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "PaymentRequest_orderId_idx" ON "PaymentRequest"("orderId");

-- CreateIndex
CREATE INDEX "PaymentRequest_mandateId_idx" ON "PaymentRequest"("mandateId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_provider_providerRef_key" ON "PaymentRequest"("provider", "providerRef");

-- CreateIndex
CREATE INDEX "PaymentRequestItem_invoiceId_idx" ON "PaymentRequestItem"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequestItem_requestId_invoiceId_key" ON "PaymentRequestItem"("requestId", "invoiceId");

-- CreateIndex
CREATE INDEX "SepaMandate_companyId_status_idx" ON "SepaMandate"("companyId", "status");

-- CreateIndex
CREATE INDEX "SepaMandate_setupRef_idx" ON "SepaMandate"("setupRef");

-- CreateIndex
CREATE INDEX "PaymentEvent_receivedAt_idx" ON "PaymentEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_provider_eventId_key" ON "PaymentEvent"("provider", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceReminder_invoiceId_kind_key" ON "InvoiceReminder"("invoiceId", "kind");

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "SepaMandate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequestItem" ADD CONSTRAINT "PaymentRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequestItem" ADD CONSTRAINT "PaymentRequestItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SepaMandate" ADD CONSTRAINT "SepaMandate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceReminder" ADD CONSTRAINT "InvoiceReminder_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Integrity rules Prisma can't express.
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_paid_has_payment" CHECK ("status" <> 'PAID' OR ("paymentId" IS NOT NULL AND "paidAt" IS NOT NULL));
ALTER TABLE "PaymentRequestItem" ADD CONSTRAINT "PaymentRequestItem_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_refund_within_amount" CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= "amount");
-- A paid request is final: its payment and amount never change afterwards.
CREATE OR REPLACE FUNCTION payment_request_paid_is_final() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'PAID' AND (NEW."status" <> 'PAID' OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId" OR NEW."paidAmount" IS DISTINCT FROM OLD."paidAmount") THEN
    RAISE EXCEPTION 'A paid payment request can''t be changed';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER payment_request_paid_is_final BEFORE UPDATE ON "PaymentRequest" FOR EACH ROW EXECUTE FUNCTION payment_request_paid_is_final();
