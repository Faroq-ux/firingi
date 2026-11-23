-- CreateTable
CREATE TABLE "ServiceType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "kind" TEXT NOT NULL DEFAULT 'VISIT',
    "unit" TEXT NOT NULL DEFAULT 'VISIT',
    "isOil" BOOLEAN NOT NULL DEFAULT false,
    "wasteCode" TEXT,
    "needsDocument" BOOLEAN NOT NULL DEFAULT false,
    "frequencies" TEXT[],
    "feeNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pricePerUnit" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "buybackPerUnit" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "providerPerVisit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "providerPerUnit" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "invoicedBy" TEXT NOT NULL DEFAULT 'FIRINGI',
    "commissionPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "commissionPerVisit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "commissionPerUnit" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "countries" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceProvider" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "serviceTypeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "countries" TEXT[],
    "licenceNumber" TEXT,
    "licenceExpiresAt" TIMESTAMP(3),
    "licenceDocKey" TEXT,
    "invoicedBy" TEXT,
    "commissionPct" DECIMAL(5,2),
    "note" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "licenceAlertedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePlan" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerCompanyId" TEXT NOT NULL,
    "serviceTypeId" TEXT NOT NULL,
    "providerId" TEXT,
    "addressId" TEXT,
    "frequency" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL DEFAULT 2,
    "dayA" INTEGER NOT NULL DEFAULT 1,
    "dayB" INTEGER NOT NULL DEFAULT 15,
    "timeWindow" TEXT NOT NULL DEFAULT 'ANY',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "pausedUntil" TIMESTAMP(3),
    "containers" INTEGER NOT NULL DEFAULT 1,
    "containerLitres" INTEGER NOT NULL DEFAULT 0,
    "autoRequestWhenFull" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceVisit" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "planId" TEXT,
    "customerCompanyId" TEXT NOT NULL,
    "serviceTypeId" TEXT NOT NULL,
    "providerId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "date" TIMESTAMP(3) NOT NULL,
    "timeWindow" TEXT NOT NULL DEFAULT 'ANY',
    "requestReason" TEXT,
    "requestedById" TEXT,
    "requestNote" TEXT,
    "quantity" DECIMAL(12,2),
    "containersTaken" INTEGER,
    "containersLeft" INTEGER,
    "providerNote" TEXT,
    "signedBy" TEXT,
    "docNumber" TEXT,
    "photoKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "missedReason" TEXT,
    "invoicedBy" TEXT NOT NULL DEFAULT 'FIRINGI',
    "feeNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "buybackNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "providerAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "commissionNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "invoiceId" TEXT,
    "providerInvoiceNo" TEXT,
    "commissionInvoiceId" TEXT,
    "buybackPaidAt" TIMESTAMP(3),
    "providerPaidAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fryer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacityL" DECIMAL(8,2) NOT NULL,
    "oilName" TEXT,
    "oilCostPerL" DECIMAL(8,4),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastChangeAt" TIMESTAMP(3),
    "lastPolarPct" DECIMAL(5,2),
    "alertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fryer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FryerLog" (
    "id" TEXT NOT NULL,
    "fryerId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "litres" DECIMAL(8,2),
    "polarPct" DECIMAL(5,2),
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byUserId" TEXT,

    CONSTRAINT "FryerLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceType_code_key" ON "ServiceType"("code");

-- CreateIndex
CREATE INDEX "ServiceProvider_serviceTypeId_status_idx" ON "ServiceProvider"("serviceTypeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceProvider_companyId_serviceTypeId_key" ON "ServiceProvider"("companyId", "serviceTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePlan_number_key" ON "ServicePlan"("number");

-- CreateIndex
CREATE INDEX "ServicePlan_customerCompanyId_status_idx" ON "ServicePlan"("customerCompanyId", "status");

-- CreateIndex
CREATE INDEX "ServicePlan_providerId_status_idx" ON "ServicePlan"("providerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceVisit_number_key" ON "ServiceVisit"("number");

-- CreateIndex
CREATE INDEX "ServiceVisit_customerCompanyId_date_idx" ON "ServiceVisit"("customerCompanyId", "date");

-- CreateIndex
CREATE INDEX "ServiceVisit_providerId_status_date_idx" ON "ServiceVisit"("providerId", "status", "date");

-- CreateIndex
CREATE INDEX "ServiceVisit_status_date_idx" ON "ServiceVisit"("status", "date");

-- CreateIndex
CREATE INDEX "ServiceVisit_invoicedBy_commissionInvoiceId_idx" ON "ServiceVisit"("invoicedBy", "commissionInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceVisit_planId_date_origin_key" ON "ServiceVisit"("planId", "date", "origin");

-- CreateIndex
CREATE INDEX "Fryer_companyId_active_idx" ON "Fryer"("companyId", "active");

-- CreateIndex
CREATE INDEX "FryerLog_companyId_at_idx" ON "FryerLog"("companyId", "at");

-- CreateIndex
CREATE INDEX "FryerLog_fryerId_at_idx" ON "FryerLog"("fryerId", "at");

-- AddForeignKey
ALTER TABLE "ServiceProvider" ADD CONSTRAINT "ServiceProvider_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePlan" ADD CONSTRAINT "ServicePlan_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePlan" ADD CONSTRAINT "ServicePlan_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ServicePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FryerLog" ADD CONSTRAINT "FryerLog_fryerId_fkey" FOREIGN KEY ("fryerId") REFERENCES "Fryer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

