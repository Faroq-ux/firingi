-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "smallOrdersPerMonth" INTEGER,
ADD COLUMN     "smallOrdersUnlimited" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "smallOrder" BOOLEAN NOT NULL DEFAULT false;

