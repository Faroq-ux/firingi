-- CreateTable
CREATE TABLE "TradeBonusNudge" (
    "bonusId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL DEFAULT '',
    "periodKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeBonusNudge_pkey" PRIMARY KEY ("bonusId","companyId","branchId","periodKey")
);

