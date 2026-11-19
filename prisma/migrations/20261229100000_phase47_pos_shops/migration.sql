-- AlterTable
ALTER TABLE "PosItem" ADD COLUMN     "registerIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AddForeignKey
ALTER TABLE "PosRegister" ADD CONSTRAINT "PosRegister_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

