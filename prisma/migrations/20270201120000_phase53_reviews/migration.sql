-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('PUBLISHED', 'HELD', 'HIDDEN');

-- CreateEnum
CREATE TYPE "AnswerRole" AS ENUM ('SUPPLIER', 'FIRINGI', 'BUYER');

-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('REVIEW', 'REPLY', 'QUESTION', 'ANSWER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'HIDDEN', 'DISMISSED');

-- CreateTable
CREATE TABLE "ProductReview" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sellerCompanyId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "offerId" TEXT,
    "orderId" TEXT,
    "stars" INTEGER NOT NULL,
    "quality" INTEGER,
    "value" INTEGER,
    "packaging" INTEGER,
    "freshness" INTEGER,
    "body" TEXT,
    "language" TEXT,
    "photos" TEXT[],
    "showName" BOOLEAN NOT NULL DEFAULT false,
    "status" "PostStatus" NOT NULL DEFAULT 'PUBLISHED',
    "holdReasons" TEXT[],
    "hiddenReason" TEXT,
    "moderatedById" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "reply" TEXT,
    "replyStatus" "PostStatus",
    "replyHold" TEXT[],
    "replyById" TEXT,
    "repliedAt" TIMESTAMP(3),
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewVote" (
    "reviewId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewVote_pkey" PRIMARY KEY ("reviewId","companyId")
);

-- CreateTable
CREATE TABLE "ContentReport" (
    "id" TEXT NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "targetId" TEXT NOT NULL,
    "byCompanyId" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductQuestion" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sellerCompanyId" TEXT,
    "buyerCompanyId" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "language" TEXT,
    "status" "PostStatus" NOT NULL DEFAULT 'PUBLISHED',
    "holdReasons" TEXT[],
    "hiddenReason" TEXT,
    "moderatedById" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "answerCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAnswer" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "role" "AnswerRole" NOT NULL,
    "body" TEXT NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'PUBLISHED',
    "holdReasons" TEXT[],
    "hiddenReason" TEXT,
    "moderatedById" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewReminder" (
    "buyerCompanyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sellerCompanyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewReminder_pkey" PRIMARY KEY ("buyerCompanyId","productId","sellerCompanyId")
);

-- CreateTable
CREATE TABLE "ProductRatingStat" (
    "productId" TEXT NOT NULL,
    "sellerCompanyId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "sum" INTEGER NOT NULL,
    "avg" DECIMAL(3,2) NOT NULL,
    "dist" INTEGER[],
    "details" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductRatingStat_pkey" PRIMARY KEY ("productId","sellerCompanyId")
);

-- CreateTable
CREATE TABLE "ReviewSummary" (
    "productId" TEXT NOT NULL,
    "sellerCompanyId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "basedOn" INTEGER NOT NULL,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewSummary_pkey" PRIMARY KEY ("productId","sellerCompanyId","locale")
);

-- CreateIndex
CREATE INDEX "ProductReview_productId_status_idx" ON "ProductReview"("productId", "status");

-- CreateIndex
CREATE INDEX "ProductReview_sellerCompanyId_status_createdAt_idx" ON "ProductReview"("sellerCompanyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ProductReview_status_createdAt_idx" ON "ProductReview"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductReview_productId_sellerCompanyId_buyerCompanyId_key" ON "ProductReview"("productId", "sellerCompanyId", "buyerCompanyId");

-- CreateIndex
CREATE INDEX "ContentReport_status_createdAt_idx" ON "ContentReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentReport_kind_targetId_byCompanyId_key" ON "ContentReport"("kind", "targetId", "byCompanyId");

-- CreateIndex
CREATE INDEX "ProductQuestion_productId_status_createdAt_idx" ON "ProductQuestion"("productId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ProductQuestion_sellerCompanyId_answerCount_idx" ON "ProductQuestion"("sellerCompanyId", "answerCount");

-- CreateIndex
CREATE INDEX "ProductAnswer_questionId_status_idx" ON "ProductAnswer"("questionId", "status");

-- CreateIndex
CREATE INDEX "ProductRatingStat_avg_idx" ON "ProductRatingStat"("avg");

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_sellerCompanyId_fkey" FOREIGN KEY ("sellerCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_byUserId_fkey" FOREIGN KEY ("byUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewVote" ADD CONSTRAINT "ReviewVote_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ProductReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductQuestion" ADD CONSTRAINT "ProductQuestion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAnswer" ADD CONSTRAINT "ProductAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ProductQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

