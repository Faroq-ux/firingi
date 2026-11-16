-- CreateTable
CREATE TABLE "PilotInvite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "type" "CompanyType" NOT NULL,
    "countryCode" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "usedByCompanyId" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PilotInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PilotInvite_code_key" ON "PilotInvite"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PilotInvite_usedByCompanyId_key" ON "PilotInvite"("usedByCompanyId");

-- CreateIndex
CREATE INDEX "PilotInvite_email_idx" ON "PilotInvite"("email");

-- AddForeignKey
ALTER TABLE "PilotInvite" ADD CONSTRAINT "PilotInvite_usedByCompanyId_fkey" FOREIGN KEY ("usedByCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
