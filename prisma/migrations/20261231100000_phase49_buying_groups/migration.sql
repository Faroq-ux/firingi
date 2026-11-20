-- CreateEnum
CREATE TYPE "BuyingGroupStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "BuyingGroupRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "BuyingGroupMemberStatus" AS ENUM ('INVITED', 'REQUESTED', 'ACTIVE', 'DECLINED', 'LEFT', 'REMOVED');

-- CreateEnum
CREATE TYPE "GroupRoundStatus" AS ENUM ('OPEN', 'PLACED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "TradeBonusAudience" ADD VALUE 'BUYING_GROUP';

-- AlterTable
ALTER TABLE "CustomerGroup" ADD COLUMN     "buyingGroupId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "groupRoundId" TEXT;

-- AlterTable
ALTER TABLE "TradeBonus" ADD COLUMN     "buyingGroupId" TEXT;

-- CreateTable
CREATE TABLE "BuyingGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "countryId" TEXT NOT NULL,
    "open" BOOLEAN NOT NULL DEFAULT true,
    "status" "BuyingGroupStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdByCompanyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyingGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyingGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" "BuyingGroupRole" NOT NULL DEFAULT 'MEMBER',
    "status" "BuyingGroupMemberStatus" NOT NULL,
    "invitedById" TEXT,
    "message" TEXT,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyingGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupOrderRound" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "sellerCompanyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "deliveryDate" TIMESTAMP(3) NOT NULL,
    "status" "GroupRoundStatus" NOT NULL DEFAULT 'OPEN',
    "placedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupOrderRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupOrderLine" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "addressId" TEXT,
    "orderId" TEXT,
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuyingGroup_status_idx" ON "BuyingGroup"("status");

-- CreateIndex
CREATE INDEX "BuyingGroupMember_companyId_status_idx" ON "BuyingGroupMember"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BuyingGroupMember_groupId_companyId_key" ON "BuyingGroupMember"("groupId", "companyId");

-- CreateIndex
CREATE INDEX "GroupOrderRound_status_closesAt_idx" ON "GroupOrderRound"("status", "closesAt");

-- CreateIndex
CREATE UNIQUE INDEX "GroupOrderLine_roundId_companyId_offerId_key" ON "GroupOrderLine"("roundId", "companyId", "offerId");

-- AddForeignKey
ALTER TABLE "BuyingGroup" ADD CONSTRAINT "BuyingGroup_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyingGroupMember" ADD CONSTRAINT "BuyingGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "BuyingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyingGroupMember" ADD CONSTRAINT "BuyingGroupMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupOrderRound" ADD CONSTRAINT "GroupOrderRound_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "BuyingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupOrderLine" ADD CONSTRAINT "GroupOrderLine_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "GroupOrderRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

