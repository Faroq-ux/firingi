-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('REQUESTED', 'QUOTED', 'ACCEPTED', 'DECLINED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "RecurringStatus" AS ENUM ('ACTIVE', 'PAUSED', 'PENDING_APPROVAL', 'ENDED');

-- CreateEnum
CREATE TYPE "BuyerApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "QuoteRequest" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "sellerCompanyId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,
    "neededBy" DATE,
    "supplierNote" TEXT,
    "validUntil" DATE,
    "quotedAt" TIMESTAMP(3),
    "quotedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "targetUnitNet" DECIMAL(18,4),
    "listUnitNet" DECIMAL(18,4) NOT NULL,
    "quotedUnitNet" DECIMAL(18,4),

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringOrder" (
    "id" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" "RecurringFrequency" NOT NULL,
    "weekday" INTEGER,
    "dayOfMonth" INTEGER,
    "deliveryAddressId" TEXT NOT NULL,
    "notes" TEXT,
    "status" "RecurringStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "remindDaysBefore" INTEGER NOT NULL DEFAULT 1,
    "reminderSentFor" TIMESTAMP(3),
    "skipNext" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "lastError" TEXT,
    "lastOrders" JSONB NOT NULL DEFAULT '[]',
    "runs" INTEGER NOT NULL DEFAULT 0,
    "approvalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringOrderItem" (
    "id" TEXT NOT NULL,
    "recurringId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "RecurringOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerApprovalRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minGross" DECIMAL(18,2),
    "categoryIds" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerApprovalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerApproval" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ORDER',
    "recurringId" TEXT,
    "quoteId" TEXT,
    "items" JSONB NOT NULL,
    "couponCode" TEXT,
    "deliveryAddressId" TEXT NOT NULL,
    "notes" TEXT,
    "requestedDeliveryDate" TIMESTAMP(3),
    "grossTotal" DECIMAL(18,2) NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "status" "BuyerApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "orders" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderList" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderListItem" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderListItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRequest_number_key" ON "QuoteRequest"("number");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRequest_orderId_key" ON "QuoteRequest"("orderId");

-- CreateIndex
CREATE INDEX "QuoteRequest_buyerCompanyId_status_idx" ON "QuoteRequest"("buyerCompanyId", "status");

-- CreateIndex
CREATE INDEX "QuoteRequest_sellerCompanyId_status_idx" ON "QuoteRequest"("sellerCompanyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLine_quoteId_offerId_key" ON "QuoteLine"("quoteId", "offerId");

-- CreateIndex
CREATE INDEX "RecurringOrder_status_nextRunAt_idx" ON "RecurringOrder"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "RecurringOrder_buyerCompanyId_idx" ON "RecurringOrder"("buyerCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringOrderItem_recurringId_offerId_key" ON "RecurringOrderItem"("recurringId", "offerId");

-- CreateIndex
CREATE INDEX "BuyerApprovalRule_companyId_idx" ON "BuyerApprovalRule"("companyId");

-- CreateIndex
CREATE INDEX "BuyerApproval_companyId_status_idx" ON "BuyerApproval"("companyId", "status");

-- CreateIndex
CREATE INDEX "OrderList_companyId_idx" ON "OrderList"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderListItem_listId_offerId_key" ON "OrderListItem"("listId", "offerId");

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_sellerCompanyId_fkey" FOREIGN KEY ("sellerCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "VendorOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringOrder" ADD CONSTRAINT "RecurringOrder_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringOrderItem" ADD CONSTRAINT "RecurringOrderItem_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "RecurringOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringOrderItem" ADD CONSTRAINT "RecurringOrderItem_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "VendorOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerApprovalRule" ADD CONSTRAINT "BuyerApprovalRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerApproval" ADD CONSTRAINT "BuyerApproval_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderList" ADD CONSTRAINT "OrderList_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderListItem" ADD CONSTRAINT "OrderListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "OrderList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderListItem" ADD CONSTRAINT "OrderListItem_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "VendorOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Checks
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_qty_check" CHECK ("qty" > 0 AND ("quotedUnitNet" IS NULL OR "quotedUnitNet" >= 0) AND ("targetUnitNet" IS NULL OR "targetUnitNet" >= 0));
ALTER TABLE "RecurringOrderItem" ADD CONSTRAINT "RecurringOrderItem_qty_check" CHECK ("qty" > 0);
ALTER TABLE "OrderListItem" ADD CONSTRAINT "OrderListItem_qty_check" CHECK ("qty" > 0);
ALTER TABLE "RecurringOrder" ADD CONSTRAINT "RecurringOrder_schedule_check" CHECK (("weekday" IS NULL OR "weekday" BETWEEN 1 AND 7) AND ("dayOfMonth" IS NULL OR "dayOfMonth" BETWEEN 1 AND 28) AND "remindDaysBefore" BETWEEN 0 AND 7);
