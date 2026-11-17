-- CreateEnum
CREATE TYPE "ReturnableKind" AS ENUM ('DEPOSIT', 'EXCHANGE');

-- CreateEnum
CREATE TYPE "ReturnableCategory" AS ENUM ('CRATE', 'KEG', 'PALLET', 'BOTTLE', 'CYLINDER', 'BOX', 'OTHER');

-- CreateEnum
CREATE TYPE "ReturnableMoveKind" AS ENUM ('OUT', 'SWAP_IN', 'RETURN', 'KEPT', 'ADJUST');

-- CreateEnum
CREATE TYPE "EmptiesSource" AS ENUM ('DELIVERY', 'PICKUP', 'DROP_OFF');

-- CreateEnum
CREATE TYPE "EmptiesReturnStatus" AS ENUM ('COLLECTED', 'CONFIRMED', 'DISPUTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "EmptiesPickupStatus" AS ENUM ('REQUESTED', 'PLANNED', 'COLLECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Cart" ADD COLUMN     "emptySwaps" JSONB;

-- CreateTable
CREATE TABLE "ReturnableType" (
    "id" TEXT NOT NULL,
    "ownerCompanyId" TEXT,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "category" "ReturnableCategory" NOT NULL,
    "kind" "ReturnableKind" NOT NULL,
    "depositNet" DECIMAL(18,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnableType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferReturnable" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "qtyPerUnit" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "OfferReturnable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderReturnable" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "qtyOut" INTEGER NOT NULL,
    "swapPlanned" INTEGER NOT NULL DEFAULT 0,
    "swapDone" INTEGER,
    "depositUnitNet" DECIMAL(18,4) NOT NULL,
    "invoicedQty" INTEGER NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(6,3) NOT NULL DEFAULT 0,

    CONSTRAINT "OrderReturnable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnableMovement" (
    "id" TEXT NOT NULL,
    "customerCompanyId" TEXT NOT NULL,
    "supplierCompanyId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "kind" "ReturnableMoveKind" NOT NULL,
    "qty" INTEGER NOT NULL,
    "orderId" TEXT,
    "returnId" TEXT,
    "note" TEXT,
    "byUserId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnableMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmptiesReturn" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerCompanyId" TEXT NOT NULL,
    "supplierCompanyId" TEXT NOT NULL,
    "source" "EmptiesSource" NOT NULL,
    "status" "EmptiesReturnStatus" NOT NULL DEFAULT 'COLLECTED',
    "deliveryId" TEXT,
    "pickupId" TEXT,
    "orderId" TEXT,
    "collectedById" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "note" TEXT,
    "disputeNote" TEXT,
    "resolution" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "creditGross" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "creditNoteIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "EmptiesReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmptiesReturnLine" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "counted" INTEGER NOT NULL,
    "accepted" INTEGER,
    "damaged" INTEGER NOT NULL DEFAULT 0,
    "credited" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EmptiesReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmptiesPickup" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerCompanyId" TEXT NOT NULL,
    "supplierCompanyId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "status" "EmptiesPickupStatus" NOT NULL DEFAULT 'REQUESTED',
    "lines" JSONB NOT NULL,
    "note" TEXT,
    "preferredDate" TIMESTAMP(3),
    "plannedDate" TIMESTAMP(3),
    "driverId" TEXT,
    "requestedById" TEXT NOT NULL,
    "returnId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmptiesPickup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReturnableType_active_idx" ON "ReturnableType"("active");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnableType_ownerCompanyId_code_key" ON "ReturnableType"("ownerCompanyId", "code");

-- CreateIndex
CREATE INDEX "OfferReturnable_typeId_idx" ON "OfferReturnable"("typeId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferReturnable_offerId_typeId_key" ON "OfferReturnable"("offerId", "typeId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderReturnable_orderId_typeId_key" ON "OrderReturnable"("orderId", "typeId");

-- CreateIndex
CREATE INDEX "ReturnableMovement_customerCompanyId_supplierCompanyId_type_idx" ON "ReturnableMovement"("customerCompanyId", "supplierCompanyId", "typeId", "at");

-- CreateIndex
CREATE INDEX "ReturnableMovement_supplierCompanyId_at_idx" ON "ReturnableMovement"("supplierCompanyId", "at");

-- CreateIndex
CREATE INDEX "ReturnableMovement_orderId_idx" ON "ReturnableMovement"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "EmptiesReturn_number_key" ON "EmptiesReturn"("number");

-- CreateIndex
CREATE INDEX "EmptiesReturn_customerCompanyId_collectedAt_idx" ON "EmptiesReturn"("customerCompanyId", "collectedAt");

-- CreateIndex
CREATE INDEX "EmptiesReturn_supplierCompanyId_status_idx" ON "EmptiesReturn"("supplierCompanyId", "status");

-- CreateIndex
CREATE INDEX "EmptiesReturnLine_returnId_idx" ON "EmptiesReturnLine"("returnId");

-- CreateIndex
CREATE UNIQUE INDEX "EmptiesPickup_number_key" ON "EmptiesPickup"("number");

-- CreateIndex
CREATE INDEX "EmptiesPickup_supplierCompanyId_status_idx" ON "EmptiesPickup"("supplierCompanyId", "status");

-- CreateIndex
CREATE INDEX "EmptiesPickup_customerCompanyId_createdAt_idx" ON "EmptiesPickup"("customerCompanyId", "createdAt");

-- CreateIndex
CREATE INDEX "EmptiesPickup_driverId_status_idx" ON "EmptiesPickup"("driverId", "status");

-- AddForeignKey
ALTER TABLE "ReturnableType" ADD CONSTRAINT "ReturnableType_ownerCompanyId_fkey" FOREIGN KEY ("ownerCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferReturnable" ADD CONSTRAINT "OfferReturnable_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "VendorOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferReturnable" ADD CONSTRAINT "OfferReturnable_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ReturnableType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderReturnable" ADD CONSTRAINT "OrderReturnable_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderReturnable" ADD CONSTRAINT "OrderReturnable_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ReturnableType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmptiesReturnLine" ADD CONSTRAINT "EmptiesReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "EmptiesReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One shared code per FIRINGI type (NULL owners are distinct for the unique index above).
CREATE UNIQUE INDEX "ReturnableType_shared_code_key" ON "ReturnableType" ("code") WHERE "ownerCompanyId" IS NULL;
ALTER TABLE "ReturnableType" ADD CONSTRAINT "returnable_deposit" CHECK ("depositNet" >= 0);
ALTER TABLE "OfferReturnable" ADD CONSTRAINT "offer_returnable_qty" CHECK ("qtyPerUnit" BETWEEN 1 AND 1000);
ALTER TABLE "OrderReturnable" ADD CONSTRAINT "order_returnable_qty" CHECK ("qtyOut" >= 0 AND "swapPlanned" >= 0 AND ("swapDone" IS NULL OR "swapDone" >= 0) AND "invoicedQty" >= 0);
ALTER TABLE "EmptiesReturnLine" ADD CONSTRAINT "empties_line_qty" CHECK ("counted" >= 0 AND ("accepted" IS NULL OR "accepted" >= 0) AND "damaged" >= 0 AND "credited" >= 0);

-- FIRINGI's shared list (any supplier can link its products to these; admins can change or add more).
INSERT INTO "ReturnableType" ("id", "ownerCompanyId", "code", "name", "category", "kind", "depositNet", "updatedAt") VALUES
  ('rt_eur_pallet', NULL, 'EUR-PALLET', '{"en":"EUR pallet","pt":"Palete EUR"}', 'PALLET', 'DEPOSIT', 10.0000, CURRENT_TIMESTAMP),
  ('rt_crate_24', NULL, 'CRATE-24', '{"en":"Beer crate (24 bottles)","pt":"Grade de cerveja (24 garrafas)"}', 'CRATE', 'DEPOSIT', 3.0000, CURRENT_TIMESTAMP),
  ('rt_bottle_glass', NULL, 'BOTTLE-GLASS', '{"en":"Returnable glass bottle","pt":"Garrafa de vidro retornável"}', 'BOTTLE', 'DEPOSIT', 0.1000, CURRENT_TIMESTAMP),
  ('rt_box_plastic', NULL, 'BOX-PLASTIC', '{"en":"Plastic transport box","pt":"Caixa plástica de transporte"}', 'BOX', 'DEPOSIT', 5.0000, CURRENT_TIMESTAMP),
  ('rt_keg_30', NULL, 'KEG-30', '{"en":"Beer keg 30 L","pt":"Barril de cerveja 30 L"}', 'KEG', 'EXCHANGE', 30.0000, CURRENT_TIMESTAMP),
  ('rt_keg_50', NULL, 'KEG-50', '{"en":"Beer keg 50 L","pt":"Barril de cerveja 50 L"}', 'KEG', 'EXCHANGE', 40.0000, CURRENT_TIMESTAMP),
  ('rt_gas_butane_13', NULL, 'GAS-BUTANE-13', '{"en":"Butane gas cylinder 13 kg","pt":"Garrafa de gás butano 13 kg"}', 'CYLINDER', 'EXCHANGE', 25.0000, CURRENT_TIMESTAMP),
  ('rt_gas_propane_11', NULL, 'GAS-PROPANE-11', '{"en":"Propane gas cylinder 11 kg","pt":"Garrafa de gás propano 11 kg"}', 'CYLINDER', 'EXCHANGE', 30.0000, CURRENT_TIMESTAMP);
