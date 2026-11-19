-- AlterTable
ALTER TABLE "AddressChangeRequest" ADD COLUMN     "proofBypassed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "proofIssuedOn" TIMESTAMP(3),
ADD COLUMN     "proofKey" TEXT,
ADD COLUMN     "proofMime" TEXT,
ADD COLUMN     "proofName" TEXT;

