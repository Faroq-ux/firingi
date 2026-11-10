-- DropIndex
DROP INDEX "AiConversation_userId_companyId_updatedAt_idx";

-- AlterTable
ALTER TABLE "AiConversation" ADD COLUMN     "side" "AiAudience" NOT NULL;

-- CreateIndex
CREATE INDEX "AiConversation_userId_companyId_side_updatedAt_idx" ON "AiConversation"("userId", "companyId", "side", "updatedAt");

