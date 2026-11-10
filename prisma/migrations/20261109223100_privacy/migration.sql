-- CreateEnum
CREATE TYPE "DataRequestType" AS ENUM ('ERASURE');

-- CreateEnum
CREATE TYPE "DataRequestStatus" AS ENUM ('REQUESTED', 'COMPLETED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "DataRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "DataRequestType" NOT NULL,
    "status" "DataRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT,
    "note" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),

    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataRequest_status_requestedAt_idx" ON "DataRequest"("status", "requestedAt");

-- AddForeignKey
ALTER TABLE "DataRequest" ADD CONSTRAINT "DataRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
