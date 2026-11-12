-- CreateEnum
CREATE TYPE "LegalForm" AS ENUM ('COMPANY', 'SOLE_TRADER');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'POS_INVOICE';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "approvalWaiver" JSONB,
ADD COLUMN     "compliancePauseReason" TEXT,
ADD COLUMN     "compliancePausedAt" TIMESTAMP(3),
ADD COLUMN     "legalForm" "LegalForm" NOT NULL DEFAULT 'COMPANY',
ADD COLUMN     "registryCertificateCode" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "issuedOn" DATE;

-- AlterTable
ALTER TABLE "VendorOffer" ADD COLUMN     "compliancePauseReason" TEXT,
ADD COLUMN     "compliancePausedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CertificateType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "appliesTo" "CompanyType"[],
    "countryIds" TEXT[],
    "categoryIds" TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "needsNumber" BOOLEAN NOT NULL DEFAULT true,
    "hasExpiry" BOOLEAN NOT NULL DEFAULT true,
    "recheckMonths" INTEGER,
    "graceDays" INTEGER NOT NULL DEFAULT 0,
    "badgeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "publicDownload" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificateType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "number" TEXT,
    "issuer" TEXT,
    "issuedOn" DATE,
    "expiresOn" DATE,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "recheckDueOn" DATE,
    "lastCheckAt" TIMESTAMP(3),
    "badgeHidden" BOOLEAN NOT NULL DEFAULT false,
    "remindedDays" INTEGER[],
    "supersededAt" TIMESTAMP(3),
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceWaiver" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "until" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CertificateType_key_key" ON "CertificateType"("key");

-- CreateIndex
CREATE INDEX "Certificate_companyId_typeId_idx" ON "Certificate"("companyId", "typeId");

-- CreateIndex
CREATE INDEX "Certificate_status_expiresOn_idx" ON "Certificate"("status", "expiresOn");

-- CreateIndex
CREATE INDEX "ComplianceWaiver_companyId_typeId_idx" ON "ComplianceWaiver"("companyId", "typeId");

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "CertificateType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceWaiver" ADD CONSTRAINT "ComplianceWaiver_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceWaiver" ADD CONSTRAINT "ComplianceWaiver_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "CertificateType"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Phase 28 checks
ALTER TABLE "CertificateType" ADD CONSTRAINT "CertificateType_grace_range" CHECK ("graceDays" >= 0 AND "graceDays" <= 365);
ALTER TABLE "CertificateType" ADD CONSTRAINT "CertificateType_recheck_range" CHECK ("recheckMonths" IS NULL OR ("recheckMonths" >= 1 AND "recheckMonths" <= 60));
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_dates" CHECK ("issuedOn" IS NULL OR "expiresOn" IS NULL OR "expiresOn" >= "issuedOn");
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_size" CHECK ("sizeBytes" > 0);

-- Sole traders in Portugal: individual NIFs start with 1, 2 or 3 (no commercial-registry certificate).
UPDATE "Company" c SET "legalForm" = 'SOLE_TRADER'
FROM "Country" k WHERE k.id = c."countryId" AND k.code = 'PT' AND c."taxId" ~ '^[123]';

-- Built-in certificate types. None is required yet, so nobody is paused by this migration —
-- FIRINGI decides in Supplier Compliance › Certificate types which ones are required.
INSERT INTO "CertificateType" ("id", "key", "name", "description", "appliesTo", "countryIds", "categoryIds", "required", "needsNumber", "hasExpiry", "recheckMonths", "graceDays", "badgeEnabled", "publicDownload", "sortOrder", "updatedAt") VALUES
 ('ctype_haccp', 'HACCP', 'HACCP food safety', 'HACCP plan / food safety certificate for the premises.', '{DISTRIBUTOR,WHOLESALER}', '{}', '{}', false, false, true, 12, 14, true, false, 10, now()),
 ('ctype_food_est', 'FOOD_ESTABLISHMENT', 'Food establishment approval', 'Veterinary / food business approval number (PT: DGAV).', '{DISTRIBUTOR,WHOLESALER}', '{}', '{}', false, true, false, 24, 0, false, false, 20, now()),
 ('ctype_organic', 'ORGANIC', 'EU organic', 'EU organic production certificate from an approved control body.', '{DISTRIBUTOR,WHOLESALER}', '{}', '{}', false, true, true, NULL, 0, true, true, 30, now()),
 ('ctype_iso22000', 'ISO_22000', 'ISO 22000 / FSSC 22000', 'Food safety management system certificate.', '{DISTRIBUTOR,WHOLESALER}', '{}', '{}', false, true, true, NULL, 30, true, true, 40, now()),
 ('ctype_ifs', 'IFS_BRCGS', 'IFS / BRCGS', 'IFS Food, IFS Logistics or BRCGS certificate.', '{DISTRIBUTOR,WHOLESALER}', '{}', '{}', false, true, true, NULL, 30, true, true, 50, now()),
 ('ctype_halal', 'HALAL', 'Halal', 'Halal certificate from a recognised certification body.', '{DISTRIBUTOR,WHOLESALER}', '{}', '{}', false, true, true, NULL, 0, true, true, 60, now()),
 ('ctype_insurance', 'LIABILITY_INSURANCE', 'Product liability insurance', 'Insurance policy covering product liability.', '{DISTRIBUTOR,WHOLESALER}', '{}', '{}', false, true, true, NULL, 14, false, false, 70, now()),
 ('ctype_tax', 'TAX_CLEARANCE', 'Tax clearance', 'Certificate of no tax debt (PT: certidão de não dívida — Finanças).', '{DISTRIBUTOR,WHOLESALER}', '{}', '{}', false, false, true, NULL, 7, false, false, 80, now()),
 ('ctype_social', 'SOCIAL_SECURITY_CLEARANCE', 'Social security clearance', 'Certificate of no social security debt (PT: Segurança Social).', '{DISTRIBUTOR,WHOLESALER}', '{}', '{}', false, false, true, NULL, 7, false, false, 90, now());

CREATE INDEX "VendorOffer_compliancePaused_idx" ON "VendorOffer"("vendorCompanyId") WHERE "compliancePausedAt" IS NOT NULL;
