-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN,
    "durationMs" INTEGER,
    "summary" JSONB,
    "error" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "path" TEXT,
    "digest" TEXT,
    "fingerprint" TEXT NOT NULL,
    "userAgent" TEXT,

    CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsAlert" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "OpsAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobRun_job_startedAt_idx" ON "JobRun"("job", "startedAt");

-- CreateIndex
CREATE INDEX "ErrorEvent_at_idx" ON "ErrorEvent"("at");

-- CreateIndex
CREATE INDEX "ErrorEvent_fingerprint_at_idx" ON "ErrorEvent"("fingerprint", "at");

-- CreateIndex
CREATE INDEX "OpsAlert_key_resolvedAt_idx" ON "OpsAlert"("key", "resolvedAt");

-- CreateIndex
CREATE INDEX "OpsAlert_resolvedAt_openedAt_idx" ON "OpsAlert"("resolvedAt", "openedAt");


-- One open alert per key.
CREATE UNIQUE INDEX "OpsAlert_one_open_per_key" ON "OpsAlert" ("key") WHERE "resolvedAt" IS NULL;
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_duration" CHECK ("durationMs" IS NULL OR "durationMs" >= 0);
