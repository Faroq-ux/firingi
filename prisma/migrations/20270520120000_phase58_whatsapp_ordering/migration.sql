-- CreateEnum
CREATE TYPE "WaDraftStatus" AS ENUM ('PENDING', 'PLACED', 'CANCELLED', 'EXPIRED', 'CHANGED');

-- AlterTable
ALTER TABLE "AiConversation" ADD COLUMN     "aiPausedUntil" TIMESTAMP(3),
ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'WEB',
ADD COLUMN     "waNumber" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "whatsappOrderUpdates" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "whatsappRemindedAt" TIMESTAMP(3),
ADD COLUMN     "whatsappReminders" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "InboundMessage" ADD COLUMN     "aiAt" TIMESTAMP(3),
ADD COLUMN     "aiNote" TEXT,
ADD COLUMN     "aiStatus" TEXT,
ADD COLUMN     "kind" TEXT,
ADD COLUMN     "mediaType" TEXT,
ADD COLUMN     "transcript" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "placedVia" TEXT NOT NULL DEFAULT 'WEB';

-- CreateTable
CREATE TABLE "WaOrderDraft" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "waNumber" TEXT NOT NULL,
    "cartHash" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "totalGross" DECIMAL(18,2) NOT NULL,
    "addressId" TEXT NOT NULL,
    "status" "WaDraftStatus" NOT NULL DEFAULT 'PENDING',
    "orderIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "orderNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approvalId" TEXT,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaOrderDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaOrderDraft_waNumber_status_idx" ON "WaOrderDraft"("waNumber", "status");

-- CreateIndex
CREATE INDEX "WaOrderDraft_companyId_createdAt_idx" ON "WaOrderDraft"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "InboundMessage_aiStatus_receivedAt_idx" ON "InboundMessage"("aiStatus", "receivedAt");

-- AddForeignKey
ALTER TABLE "WaOrderDraft" ADD CONSTRAINT "WaOrderDraft_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

