-- CreateEnum
CREATE TYPE "PriceChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'APPLIED');

-- CreateEnum
CREATE TYPE "PriceAlertKind" AS ENUM ('JUMP', 'ABOVE_MARKET', 'BELOW_MARKET');

-- CreateEnum
CREATE TYPE "PriceAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'DISMISSED', 'RESOLVED');

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "scope" "PriceListScope" NOT NULL,
    "minQty" INTEGER NOT NULL,
    "oldPrice" DECIMAL(18,4),
    "newPrice" DECIMAL(18,4),
    "changePct" DECIMAL(9,2),
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceChangeRequest" (
    "id" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "minQty" INTEGER NOT NULL,
    "oldPrice" DECIMAL(18,4) NOT NULL,
    "newPrice" DECIMAL(18,4) NOT NULL,
    "changePct" DECIMAL(9,2) NOT NULL,
    "reason" TEXT,
    "status" "PriceChangeStatus" NOT NULL DEFAULT 'PENDING',
    "effectiveAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "noticeSent" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceAlert" (
    "id" TEXT NOT NULL,
    "kind" "PriceAlertKind" NOT NULL,
    "status" "PriceAlertStatus" NOT NULL DEFAULT 'OPEN',
    "offerId" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "reference" DECIMAL(18,4) NOT NULL,
    "deviationPct" DECIMAL(9,2) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "PriceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceHistory_offerId_changedAt_idx" ON "PriceHistory"("offerId", "changedAt");

-- CreateIndex
CREATE INDEX "PriceHistory_changedAt_idx" ON "PriceHistory"("changedAt");

-- CreateIndex
CREATE INDEX "PriceChangeRequest_status_effectiveAt_idx" ON "PriceChangeRequest"("status", "effectiveAt");

-- CreateIndex
CREATE INDEX "PriceChangeRequest_vendorCompanyId_status_idx" ON "PriceChangeRequest"("vendorCompanyId", "status");

-- CreateIndex
CREATE INDEX "PriceChangeRequest_offerId_status_idx" ON "PriceChangeRequest"("offerId", "status");

-- CreateIndex
CREATE INDEX "PriceAlert_status_kind_idx" ON "PriceAlert"("status", "kind");

-- CreateIndex
CREATE INDEX "PriceAlert_offerId_kind_idx" ON "PriceAlert"("offerId", "kind");

-- AddForeignKey
ALTER TABLE "PriceChangeRequest" ADD CONSTRAINT "PriceChangeRequest_vendorCompanyId_fkey" FOREIGN KEY ("vendorCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceChangeRequest" ADD CONSTRAINT "PriceChangeRequest_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "VendorOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceChangeRequest" ADD CONSTRAINT "PriceChangeRequest_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "VendorOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_vendorCompanyId_fkey" FOREIGN KEY ("vendorCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Phase 29: every price change is recorded, whatever wrote it ────────────
CREATE OR REPLACE FUNCTION firingi_price_history() RETURNS trigger AS $$
DECLARE s "PriceListScope";
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."unitPriceNet" = OLD."unitPriceNet" THEN RETURN NEW; END IF;
  SELECT scope INTO s FROM "PriceList" WHERE id = COALESCE(NEW."priceListId", OLD."priceListId");
  IF s IS NULL THEN RETURN COALESCE(NEW, OLD); END IF; -- price list being deleted (cascade)
  INSERT INTO "PriceHistory" (id, "offerId", "priceListId", scope, "minQty", "oldPrice", "newPrice", "changePct", "changedAt")
  VALUES (
    'ph_' || replace(gen_random_uuid()::text, '-', ''),
    COALESCE(NEW."offerId", OLD."offerId"), COALESCE(NEW."priceListId", OLD."priceListId"), s, COALESCE(NEW."minQty", OLD."minQty"),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."unitPriceNet" END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."unitPriceNet" END,
    CASE WHEN TG_OP = 'UPDATE' AND OLD."unitPriceNet" > 0 THEN round((NEW."unitPriceNet" - OLD."unitPriceNet") / OLD."unitPriceNet" * 100, 2) ELSE NULL END,
    now());
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

CREATE TRIGGER price_list_item_history
  AFTER INSERT OR UPDATE OR DELETE ON "PriceListItem"
  FOR EACH ROW EXECUTE FUNCTION firingi_price_history();

CREATE TRIGGER price_history_append_only
  BEFORE UPDATE OR DELETE ON "PriceHistory"
  FOR EACH ROW EXECUTE FUNCTION firingi_forbid_change();

-- the prices that exist today start the history
INSERT INTO "PriceHistory" (id, "offerId", "priceListId", scope, "minQty", "oldPrice", "newPrice", "changePct", "changedAt")
SELECT 'ph_' || replace(gen_random_uuid()::text, '-', ''), i."offerId", i."priceListId", l.scope, i."minQty", NULL, i."unitPriceNet", NULL, LEAST(l."createdAt", now())
FROM "PriceListItem" i JOIN "PriceList" l ON l.id = i."priceListId";

CREATE UNIQUE INDEX "PriceAlert_one_open" ON "PriceAlert"("offerId", kind) WHERE status IN ('OPEN', 'ACKNOWLEDGED');
CREATE UNIQUE INDEX "PriceChangeRequest_one_pending" ON "PriceChangeRequest"("priceListId", "offerId", "minQty") WHERE status IN ('PENDING', 'APPROVED');
ALTER TABLE "PriceChangeRequest" ADD CONSTRAINT "PriceChangeRequest_prices" CHECK ("oldPrice" > 0 AND "newPrice" > 0 AND "minQty" >= 1);
