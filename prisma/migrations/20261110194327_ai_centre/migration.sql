-- CreateEnum
CREATE TYPE "AiRecStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DISMISSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AiAudience" AS ENUM ('STAFF', 'BUYER', 'VENDOR');

-- CreateTable
CREATE TABLE "AiRecommendation" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "audience" "AiAudience" NOT NULL,
    "companyId" TEXT,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "status" "AiRecStatus" NOT NULL DEFAULT 'OPEN',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiActivity" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorUserId" TEXT,
    "companyId" TEXT,
    "summary" TEXT NOT NULL,
    "detail" JSONB,
    "model" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "tools" JSONB,
    "model" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "stopReason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiRecommendation_dedupeKey_key" ON "AiRecommendation"("dedupeKey");

-- CreateIndex
CREATE INDEX "AiRecommendation_audience_status_score_idx" ON "AiRecommendation"("audience", "status", "score");

-- CreateIndex
CREATE INDEX "AiRecommendation_companyId_status_idx" ON "AiRecommendation"("companyId", "status");

-- CreateIndex
CREATE INDEX "AiRecommendation_kind_status_idx" ON "AiRecommendation"("kind", "status");

-- CreateIndex
CREATE INDEX "AiActivity_at_idx" ON "AiActivity"("at");

-- CreateIndex
CREATE INDEX "AiActivity_kind_at_idx" ON "AiActivity"("kind", "at");

-- CreateIndex
CREATE INDEX "AiActivity_companyId_at_idx" ON "AiActivity"("companyId", "at");

-- CreateIndex
CREATE INDEX "AiConversation_userId_companyId_updatedAt_idx" ON "AiConversation"("userId", "companyId", "updatedAt");

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_at_idx" ON "AiMessage"("conversationId", "at");

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "AiRecommendation" ADD CONSTRAINT "AiRecommendation_score_range" CHECK ("score" BETWEEN 0 AND 100);
ALTER TABLE "AiRecommendation" ADD CONSTRAINT "AiRecommendation_company_audience" CHECK (("audience"::text = 'STAFF') = ("companyId" IS NULL));
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_role" CHECK ("role" IN ('user', 'assistant'));
