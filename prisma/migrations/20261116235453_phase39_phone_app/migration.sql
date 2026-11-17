-- CreateEnum
CREATE TYPE "OfflineOpStatus" AS ENUM ('PROCESSING', 'DONE', 'NEEDS_CONFIRM', 'FAILED');

-- CreateTable
CREATE TABLE "OfflineOp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "portal" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "OfflineOpStatus" NOT NULL DEFAULT 'PROCESSING',
    "result" JSONB,
    "error" TEXT,
    "clientAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfflineOp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppInstall" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "portal" TEXT NOT NULL,
    "platform" TEXT,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOpenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opens" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "AppInstall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfflineOp_companyId_createdAt_idx" ON "OfflineOp"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "OfflineOp_kind_status_createdAt_idx" ON "OfflineOp"("kind", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OfflineOp_userId_clientId_key" ON "OfflineOp"("userId", "clientId");

-- CreateIndex
CREATE INDEX "AppInstall_portal_lastOpenedAt_idx" ON "AppInstall"("portal", "lastOpenedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppInstall_userId_portal_key" ON "AppInstall"("userId", "portal");
