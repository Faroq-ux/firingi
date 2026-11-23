-- CreateTable
CREATE TABLE "HaccpUnit" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "minC" DECIMAL(5,1),
    "maxC" DECIMAL(5,1),
    "times" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "alertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HaccpUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HaccpTask" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "weekday" INTEGER,
    "dayOfMonth" INTEGER,
    "items" TEXT[],
    "needsPhoto" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HaccpTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HaccpEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "unitId" TEXT,
    "taskId" TEXT,
    "forDate" DATE NOT NULL,
    "slot" TEXT,
    "valueC" DECIMAL(5,1),
    "startC" DECIMAL(5,1),
    "minutes" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "results" JSONB,
    "product" TEXT,
    "supplier" TEXT,
    "orderId" TEXT,
    "note" TEXT,
    "corrective" TEXT,
    "photoKey" TEXT,
    "byUserId" TEXT,
    "byName" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HaccpEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HaccpTraining" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "personName" TEXT NOT NULL,
    "userId" TEXT,
    "course" TEXT NOT NULL,
    "certificateNo" TEXT,
    "issuedAt" DATE NOT NULL,
    "expiresAt" DATE,
    "note" TEXT,
    "alertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HaccpTraining_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HaccpUnit_companyId_active_idx" ON "HaccpUnit"("companyId", "active");

-- CreateIndex
CREATE INDEX "HaccpTask_companyId_active_idx" ON "HaccpTask"("companyId", "active");

-- CreateIndex
CREATE INDEX "HaccpEntry_companyId_forDate_idx" ON "HaccpEntry"("companyId", "forDate");

-- CreateIndex
CREATE INDEX "HaccpEntry_companyId_kind_at_idx" ON "HaccpEntry"("companyId", "kind", "at");

-- CreateIndex
CREATE INDEX "HaccpEntry_unitId_at_idx" ON "HaccpEntry"("unitId", "at");

-- CreateIndex
CREATE INDEX "HaccpTraining_companyId_idx" ON "HaccpTraining"("companyId");

-- CreateIndex
CREATE INDEX "HaccpTraining_expiresAt_idx" ON "HaccpTraining"("expiresAt");

-- AddForeignKey
ALTER TABLE "HaccpEntry" ADD CONSTRAINT "HaccpEntry_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "HaccpUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HaccpEntry" ADD CONSTRAINT "HaccpEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "HaccpTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

