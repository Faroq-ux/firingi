-- AlterTable
ALTER TABLE "PosRegister" ADD COLUMN     "approval" TEXT NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedById" TEXT,
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "requestedById" TEXT;

-- CreateTable
CREATE TABLE "PosRegisterUser" (
    "registerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'SELL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosRegisterUser_pkey" PRIMARY KEY ("registerId","userId")
);

-- CreateIndex
CREATE INDEX "PosRegisterUser_userId_idx" ON "PosRegisterUser"("userId");

-- AddForeignKey
ALTER TABLE "PosRegisterUser" ADD CONSTRAINT "PosRegisterUser_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "PosRegister"("id") ON DELETE CASCADE ON UPDATE CASCADE;

