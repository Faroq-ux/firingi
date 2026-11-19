-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "restrictedDeclared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sellsRestricted" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "SpecialAccessException" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialAccessException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpecialAccessException_companyId_target_key" ON "SpecialAccessException"("companyId", "target");

-- AddForeignKey
ALTER TABLE "SpecialAccessException" ADD CONSTRAINT "SpecialAccessException_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

