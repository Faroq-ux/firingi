-- CreateTable
CREATE TABLE "JobApplication" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL DEFAULT '',
    "jobTitle" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "link" TEXT,
    "message" TEXT,
    "locale" TEXT NOT NULL,
    "consentText" TEXT NOT NULL,
    "ipHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobApplication_status_createdAt_idx" ON "JobApplication"("status", "createdAt");

