-- CreateEnum
CREATE TYPE "ChatChannel" AS ENUM ('BUYER_SUPPLIER', 'BUYER_FIRINGI', 'SUPPLIER_FIRINGI', 'DRIVER');

-- CreateEnum
CREATE TYPE "ChatSide" AS ENUM ('BUYER', 'SUPPLIER', 'FIRINGI', 'DRIVER');

-- CreateTable
CREATE TABLE "OrderThread" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "channel" "ChatChannel" NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorCompanyId" TEXT NOT NULL,
    "authorSide" "ChatSide" NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "originalBody" TEXT,
    "locale" TEXT NOT NULL,
    "flags" TEXT[],
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "photoKeys" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderMessageTranslation" (
    "messageId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderMessageTranslation_pkey" PRIMARY KEY ("messageId","locale")
);

-- CreateTable
CREATE TABLE "OrderThreadRead" (
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderThreadRead_pkey" PRIMARY KEY ("threadId","userId")
);

-- CreateIndex
CREATE INDEX "OrderThread_lastMessageAt_idx" ON "OrderThread"("lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderThread_orderId_channel_key" ON "OrderThread"("orderId", "channel");

-- CreateIndex
CREATE INDEX "OrderMessage_threadId_createdAt_idx" ON "OrderMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderMessage_createdAt_idx" ON "OrderMessage"("createdAt");

-- AddForeignKey
ALTER TABLE "OrderThread" ADD CONSTRAINT "OrderThread_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMessage" ADD CONSTRAINT "OrderMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "OrderThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMessageTranslation" ADD CONSTRAINT "OrderMessageTranslation_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "OrderMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderThreadRead" ADD CONSTRAINT "OrderThreadRead_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "OrderThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

