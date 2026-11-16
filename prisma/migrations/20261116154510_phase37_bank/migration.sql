-- CreateEnum
CREATE TYPE "BankFormat" AS ENUM ('CAMT053', 'MT940', 'CSV', 'XLSX', 'FEED');

-- CreateEnum
CREATE TYPE "BankLineStatus" AS ENUM ('OPEN', 'SUGGESTED', 'MATCHED', 'IGNORED');

-- CreateEnum
CREATE TYPE "BankMatchKind" AS ENUM ('CUSTOMER_PAYMENT', 'VENDOR_PAYOUT', 'PAYMENT', 'FIRINGI_INVOICE', 'ENTRY', 'FEE', 'OTHER');

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "companyId" TEXT,
    "legalEntityId" TEXT,
    "name" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "bic" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "csvMapping" JSONB,
    "feedProvider" TEXT,
    "feedAccountId" TEXT,
    "feedRequisition" TEXT,
    "feedStatus" TEXT,
    "feedConsentUntil" TIMESTAMP(3),
    "feedLastAt" TIMESTAMP(3),
    "feedError" TEXT,
    "autoBook" BOOLEAN NOT NULL DEFAULT false,
    "balance" DECIMAL(18,2),
    "balanceAt" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "format" "BankFormat" NOT NULL,
    "fileName" TEXT,
    "bankStatementId" TEXT,
    "fromDate" DATE,
    "toDate" DATE,
    "openingBalance" DECIMAL(18,2),
    "closingBalance" DECIMAL(18,2),
    "balanceOk" BOOLEAN,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "newLines" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "autoMatched" INTEGER NOT NULL DEFAULT 0,
    "importedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankLine" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "statementId" TEXT,
    "bookingDate" DATE NOT NULL,
    "valueDate" DATE,
    "amount" DECIMAL(18,2) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "counterparty" TEXT,
    "counterpartyIban" TEXT,
    "remittance" TEXT,
    "endToEndId" TEXT,
    "bankRef" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "status" "BankLineStatus" NOT NULL DEFAULT 'OPEN',
    "suggestion" JSONB,
    "confidence" INTEGER,
    "autoMatched" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "matchedById" TEXT,
    "matchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankMatch" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "kind" "BankMatchKind" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paymentId" TEXT,
    "createdPayment" BOOLEAN NOT NULL DEFAULT false,
    "invoiceId" TEXT,
    "accountingEntryId" TEXT,
    "companyId" TEXT,
    "category" TEXT,
    "label" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankPayerLink" (
    "id" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "companyId" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankPayerLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankRule" (
    "id" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contains" TEXT NOT NULL,
    "direction" TEXT,
    "kind" "BankMatchKind" NOT NULL DEFAULT 'OTHER',
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankAccount_companyId_idx" ON "BankAccount"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_ownerKey_iban_key" ON "BankAccount"("ownerKey", "iban");

-- CreateIndex
CREATE INDEX "BankStatement_accountId_createdAt_idx" ON "BankStatement"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "BankLine_accountId_status_bookingDate_idx" ON "BankLine"("accountId", "status", "bookingDate");

-- CreateIndex
CREATE UNIQUE INDEX "BankLine_accountId_dedupeKey_key" ON "BankLine"("accountId", "dedupeKey");

-- CreateIndex
CREATE INDEX "BankMatch_lineId_idx" ON "BankMatch"("lineId");

-- CreateIndex
CREATE INDEX "BankMatch_paymentId_idx" ON "BankMatch"("paymentId");

-- CreateIndex
CREATE INDEX "BankMatch_invoiceId_idx" ON "BankMatch"("invoiceId");

-- CreateIndex
CREATE INDEX "BankMatch_accountingEntryId_idx" ON "BankMatch"("accountingEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "BankPayerLink_ownerKey_iban_key" ON "BankPayerLink"("ownerKey", "iban");

-- CreateIndex
CREATE INDEX "BankRule_ownerKey_idx" ON "BankRule"("ownerKey");

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankLine" ADD CONSTRAINT "BankLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankLine" ADD CONSTRAINT "BankLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankMatch" ADD CONSTRAINT "BankMatch_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "BankLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankMatch" ADD CONSTRAINT "BankMatch_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
