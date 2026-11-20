-- CreateEnum
CREATE TYPE "KitchenUnit" AS ENUM ('KG', 'L', 'PCS');

-- CreateEnum
CREATE TYPE "IngredientSource" AS ENUM ('FIRINGI', 'MANUAL');

-- CreateEnum
CREATE TYPE "KitchenRecipeKind" AS ENUM ('DISH', 'SUB');

-- CreateEnum
CREATE TYPE "WasteReason" AS ENUM ('EXPIRED', 'SPOILED', 'OVERPRODUCTION', 'PLATE_WASTE', 'DAMAGED', 'PREP_LOSS', 'OTHER');

-- CreateEnum
CREATE TYPE "WasteKind" AS ENUM ('WASTE', 'DONATION');

-- CreateTable
CREATE TABLE "KitchenIngredient" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" "IngredientSource" NOT NULL,
    "productId" TEXT,
    "offerId" TEXT,
    "unit" "KitchenUnit" NOT NULL,
    "packSize" DECIMAL(12,4),
    "manualCost" DECIMAL(14,4),
    "supplierName" TEXT,
    "yieldPct" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allergensOwn" BOOLEAN NOT NULL DEFAULT false,
    "co2PerUnit" DECIMAL(12,4),
    "cost" DECIMAL(14,4),
    "costAt" TIMESTAMP(3),
    "costBasis" TEXT,
    "prevCost" DECIMAL(14,4),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitchenIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenRecipe" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "KitchenRecipeKind" NOT NULL DEFAULT 'DISH',
    "category" TEXT,
    "posItemId" TEXT,
    "yieldQty" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "yieldUnit" "KitchenUnit",
    "priceGross" DECIMAL(14,4),
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 13,
    "targetPct" DECIMAL(5,2),
    "soldPerWeek" INTEGER,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitchenRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenRecipeLine" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "ingredientId" TEXT,
    "subRecipeId" TEXT,
    "qty" DECIMAL(12,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "KitchenRecipeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenWaste" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "WasteKind" NOT NULL DEFAULT 'WASTE',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" "WasteReason",
    "ingredientId" TEXT,
    "recipeId" TEXT,
    "lotId" TEXT,
    "label" TEXT NOT NULL,
    "qty" DECIMAL(12,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "kgWeight" DECIMAL(12,3),
    "co2Kg" DECIMAL(12,3),
    "recipient" TEXT,
    "receiptRef" TEXT,
    "note" TEXT,
    "byUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KitchenWaste_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenProfile" (
    "companyId" TEXT NOT NULL,
    "targetFoodCostPct" DECIMAL(5,2),
    "wasteTargetPct" DECIMAL(5,2),
    "costBasis" TEXT,
    "rounding" TEXT,
    "wasteAlertMonth" TEXT,
    "useFirstSentOn" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitchenProfile_pkey" PRIMARY KEY ("companyId")
);

-- CreateIndex
CREATE INDEX "KitchenIngredient_companyId_active_idx" ON "KitchenIngredient"("companyId", "active");

-- CreateIndex
CREATE INDEX "KitchenIngredient_companyId_productId_idx" ON "KitchenIngredient"("companyId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenRecipe_posItemId_key" ON "KitchenRecipe"("posItemId");

-- CreateIndex
CREATE INDEX "KitchenRecipe_companyId_kind_active_idx" ON "KitchenRecipe"("companyId", "kind", "active");

-- CreateIndex
CREATE INDEX "KitchenRecipeLine_recipeId_idx" ON "KitchenRecipeLine"("recipeId");

-- CreateIndex
CREATE INDEX "KitchenWaste_companyId_kind_at_idx" ON "KitchenWaste"("companyId", "kind", "at");

-- AddForeignKey
ALTER TABLE "KitchenRecipeLine" ADD CONSTRAINT "KitchenRecipeLine_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "KitchenRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenRecipeLine" ADD CONSTRAINT "KitchenRecipeLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "KitchenIngredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenRecipeLine" ADD CONSTRAINT "KitchenRecipeLine_subRecipeId_fkey" FOREIGN KEY ("subRecipeId") REFERENCES "KitchenRecipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenWaste" ADD CONSTRAINT "KitchenWaste_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "KitchenIngredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenWaste" ADD CONSTRAINT "KitchenWaste_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "KitchenRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

