-- CreateTable
CREATE TABLE "WarehouseFeatures" (
    "companyId" TEXT NOT NULL,
    "pickPack" BOOLEAN NOT NULL DEFAULT true,
    "bins" BOOLEAN NOT NULL DEFAULT true,
    "traceability" BOOLEAN NOT NULL DEFAULT true,
    "recalls" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "WarehouseFeatures_pkey" PRIMARY KEY ("companyId")
);

-- AddForeignKey
ALTER TABLE "WarehouseFeatures" ADD CONSTRAINT "WarehouseFeatures_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

