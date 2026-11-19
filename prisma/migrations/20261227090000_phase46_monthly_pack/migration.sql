-- AlterTable
ALTER TABLE "EInvoiceProfile" ADD COLUMN     "accountantEmail" TEXT;

-- CreateTable
CREATE TABLE "EInvoiceMonthlyPack" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "sentTo" TEXT,
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EInvoiceMonthlyPack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EInvoiceMonthlyPack_companyId_period_key" ON "EInvoiceMonthlyPack"("companyId", "period");

-- AddForeignKey
ALTER TABLE "EInvoiceMonthlyPack" ADD CONSTRAINT "EInvoiceMonthlyPack_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

