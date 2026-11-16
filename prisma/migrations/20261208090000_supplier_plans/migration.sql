-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('TRIAL', 'ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlanBilling" AS ENUM ('PAYOUT', 'INVOICE');

-- CreateEnum
CREATE TYPE "EarlyPayStatus" AS ENUM ('REQUESTED', 'PAID', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "SupplierPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthlyPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "commissionPct" DECIMAL(6,3),
    "features" TEXT[],
    "maxProducts" INTEGER,
    "maxUsers" INTEGER,
    "maxWarehouses" INTEGER,
    "maxDrivers" INTEGER,
    "earlyPayModel" TEXT NOT NULL DEFAULT 'OFF',
    "earlyPayRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "earlyPayMinFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "freeEarlyPays" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanSubscription" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "pendingPlanId" TEXT,
    "billing" "PlanBilling" NOT NULL DEFAULT 'PAYOUT',
    "commissionLocked" BOOLEAN NOT NULL DEFAULT false,
    "earlyPayEnabled" BOOLEAN NOT NULL DEFAULT true,
    "earlyPayLimit" DECIMAL(12,2),
    "remindersSent" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "billing" "PlanBilling" NOT NULL,
    "net" DECIMAL(10,2) NOT NULL,
    "gross" DECIMAL(10,2) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PERIOD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarlyPayout" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "EarlyPayStatus" NOT NULL DEFAULT 'REQUESTED',
    "amount" DECIMAL(12,2) NOT NULL,
    "fee" DECIMAL(10,2) NOT NULL,
    "feeGross" DECIMAL(10,2) NOT NULL,
    "net" DECIMAL(12,2) NOT NULL,
    "model" TEXT NOT NULL,
    "rate" DECIMAL(8,4) NOT NULL,
    "feeInvoiceId" TEXT,
    "reference" TEXT,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EarlyPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarlyPayoutLine" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "vendorInvoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "dueDate" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "fee" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "EarlyPayoutLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPlan_code_key" ON "SupplierPlan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PlanSubscription_companyId_key" ON "PlanSubscription"("companyId");

-- CreateIndex
CREATE INDEX "PlanSubscription_status_trialEndsAt_idx" ON "PlanSubscription"("status", "trialEndsAt");

-- CreateIndex
CREATE INDEX "PlanSubscription_periodEnd_idx" ON "PlanSubscription"("periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "PlanInvoice_invoiceId_key" ON "PlanInvoice"("invoiceId");

-- CreateIndex
CREATE INDEX "PlanInvoice_companyId_createdAt_idx" ON "PlanInvoice"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EarlyPayout_number_key" ON "EarlyPayout"("number");

-- CreateIndex
CREATE INDEX "EarlyPayout_companyId_createdAt_idx" ON "EarlyPayout"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "EarlyPayout_status_idx" ON "EarlyPayout"("status");

-- CreateIndex
CREATE INDEX "EarlyPayoutLine_vendorInvoiceId_idx" ON "EarlyPayoutLine"("vendorInvoiceId");

-- AddForeignKey
ALTER TABLE "PlanSubscription" ADD CONSTRAINT "PlanSubscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanSubscription" ADD CONSTRAINT "PlanSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SupplierPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanSubscription" ADD CONSTRAINT "PlanSubscription_pendingPlanId_fkey" FOREIGN KEY ("pendingPlanId") REFERENCES "SupplierPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanInvoice" ADD CONSTRAINT "PlanInvoice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SupplierPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarlyPayout" ADD CONSTRAINT "EarlyPayout_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarlyPayoutLine" ADD CONSTRAINT "EarlyPayoutLine_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "EarlyPayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

