-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ConsignmentStatus" ADD VALUE 'PENDING';
ALTER TYPE "ConsignmentStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "ConsignmentSite" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedById" TEXT,
ADD COLUMN     "rejectReason" TEXT;

