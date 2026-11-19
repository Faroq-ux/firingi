-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "activityCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];

