-- CreateEnum
CREATE TYPE "FiscalStatus" AS ENUM ('LOCAL', 'PENDING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "fiscalAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fiscalError" TEXT,
ADD COLUMN     "fiscalNextAt" TIMESTAMP(3),
ADD COLUMN     "fiscalStatus" "FiscalStatus" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN     "providerData" JSONB,
ADD COLUMN     "providerNumber" TEXT;

-- CreateTable
CREATE TABLE "ProviderEntityMap" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderEntityMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEntityMap_provider_kind_localId_key" ON "ProviderEntityMap"("provider", "kind", "localId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_providerNumber_key" ON "Invoice"("providerNumber");

-- CreateIndex
CREATE INDEX "Invoice_fiscalStatus_fiscalNextAt_idx" ON "Invoice"("fiscalStatus", "fiscalNextAt");


-- A certified provider (Moloni) issues the legal document after FIRINGI books it: the hash /
-- ATCUD / QR and the provider's number may be filled in ONCE (from empty), never changed.
CREATE OR REPLACE FUNCTION firingi_invoice_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'INVOICE_IMMUTABLE: issued invoice % cannot be deleted; issue a credit note', OLD."fullNumber"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'DRAFT' AND (
       NEW."docType" IS DISTINCT FROM OLD."docType" OR
       NEW."number" IS DISTINCT FROM OLD."number" OR
       NEW."fullNumber" IS DISTINCT FROM OLD."fullNumber" OR
       NEW."seriesId" IS DISTINCT FROM OLD."seriesId" OR
       NEW."legalEntityId" IS DISTINCT FROM OLD."legalEntityId" OR
       NEW."recipientCompanyId" IS DISTINCT FROM OLD."recipientCompanyId" OR
       NEW."issuerSnapshot" IS DISTINCT FROM OLD."issuerSnapshot" OR
       NEW."recipientSnapshot" IS DISTINCT FROM OLD."recipientSnapshot" OR
       NEW."orderId" IS DISTINCT FROM OLD."orderId" OR
       NEW."netTotal" IS DISTINCT FROM OLD."netTotal" OR
       NEW."vatTotal" IS DISTINCT FROM OLD."vatTotal" OR
       NEW."grossTotal" IS DISTINCT FROM OLD."grossTotal" OR
       NEW."taxRegime" IS DISTINCT FROM OLD."taxRegime" OR
       NEW."currencyCode" IS DISTINCT FROM OLD."currencyCode" OR
       NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt" OR
       (OLD."hash" IS NOT NULL AND NEW."hash" IS DISTINCT FROM OLD."hash") OR
       (OLD."atcud" IS NOT NULL AND NEW."atcud" IS DISTINCT FROM OLD."atcud") OR
       (OLD."providerNumber" IS NOT NULL AND NEW."providerNumber" IS DISTINCT FROM OLD."providerNumber") OR
       (OLD."fiscalStatus" = 'DONE' AND NEW."fiscalStatus" <> 'DONE') OR
       NEW.status = 'DRAFT'
     ) THEN
    RAISE EXCEPTION 'INVOICE_IMMUTABLE: issued invoice % cannot be modified', OLD."fullNumber"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_fiscal_done_has_number" CHECK ("fiscalStatus"::text <> 'DONE' OR "providerNumber" IS NOT NULL);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_fiscal_attempts" CHECK ("fiscalAttempts" >= 0);
