-- CreateTable
CREATE TABLE "AiReportRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "model" TEXT,
    "byClaude" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "emailedAt" TIMESTAMP(3),
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiReportRun_kind_createdAt_idx" ON "AiReportRun"("kind", "createdAt");

