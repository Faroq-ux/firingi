-- CreateEnum
CREATE TYPE "ExciseKind" AS ENUM ('ALCOHOL', 'TOBACCO', 'VAPING', 'SUGAR');

-- CreateEnum
CREATE TYPE "ExciseBasis" AS ENUM ('HL_PURE_ALCOHOL', 'HL_PER_ABV', 'HL_PRODUCT', 'THOUSAND_UNITS', 'KG', 'ML', 'HL_SUGAR_BAND');

-- CreateEnum
CREATE TYPE "DutyMode" AS ENUM ('PAID', 'ADDED');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "exciseCategoryId" TEXT;

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "exciseCheckedAt" TIMESTAMP(3),
ADD COLUMN     "exciseCheckedById" TEXT,
ADD COLUMN     "exciseDocRef" TEXT,
ADD COLUMN     "exciseDocType" TEXT;

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "exciseNet" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "exciseAddedNet" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "exciseAddedVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "exciseIncludedNet" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "exciseCategoryId" TEXT,
ADD COLUMN     "exciseMeasure" JSONB,
ADD COLUMN     "exciseMode" "DutyMode",
ADD COLUMN     "exciseNet" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "exciseUnitNet" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "VendorOffer" ADD COLUMN     "abv" DECIMAL(5,2),
ADD COLUMN     "dutyMode" "DutyMode" NOT NULL DEFAULT 'PAID',
ADD COLUMN     "exciseCategoryId" TEXT,
ADD COLUMN     "exciseCountries" TEXT[],
ADD COLUMN     "exciseUnits" INTEGER,
ADD COLUMN     "netKg" DECIMAL(10,3),
ADD COLUMN     "sugarGPerL" DECIMAL(7,2),
ADD COLUMN     "volumeL" DECIMAL(10,3);

-- CreateTable
CREATE TABLE "ExciseCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "kind" "ExciseKind" NOT NULL,
    "basis" "ExciseBasis" NOT NULL,
    "maxPerOrder" INTEGER,
    "blockedCountries" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExciseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExciseRate" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "adValoremPct" DECIMAL(6,3),
    "bands" JSONB,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExciseRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenceType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "kinds" "ExciseKind"[],
    "countries" TEXT[],
    "needsNumber" BOOLEAN NOT NULL DEFAULT true,
    "hasExpiry" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerLicence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "number" TEXT,
    "issuer" TEXT,
    "countryCode" TEXT NOT NULL,
    "issuedOn" DATE,
    "expiresOn" DATE,
    "fileKey" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "remindedDays" INTEGER[],
    "supersededAt" TIMESTAMP(3),
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerLicence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExciseCategory_code_key" ON "ExciseCategory"("code");

-- CreateIndex
CREATE INDEX "ExciseRate_categoryId_countryCode_validFrom_idx" ON "ExciseRate"("categoryId", "countryCode", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "LicenceType_code_key" ON "LicenceType"("code");

-- CreateIndex
CREATE INDEX "CustomerLicence_companyId_typeId_idx" ON "CustomerLicence"("companyId", "typeId");

-- CreateIndex
CREATE INDEX "CustomerLicence_status_expiresOn_idx" ON "CustomerLicence"("status", "expiresOn");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_exciseCategoryId_fkey" FOREIGN KEY ("exciseCategoryId") REFERENCES "ExciseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorOffer" ADD CONSTRAINT "VendorOffer_exciseCategoryId_fkey" FOREIGN KEY ("exciseCategoryId") REFERENCES "ExciseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExciseRate" ADD CONSTRAINT "ExciseRate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExciseCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerLicence" ADD CONSTRAINT "CustomerLicence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerLicence" ADD CONSTRAINT "CustomerLicence_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "LicenceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_exciseCategoryId_fkey" FOREIGN KEY ("exciseCategoryId") REFERENCES "ExciseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Phase 43 reference data ──────────────────────────────────────────────────
ALTER TABLE "ExciseRate" ADD CONSTRAINT "ExciseRate_rate_check" CHECK ("rate" >= 0);
ALTER TABLE "ExciseRate" ADD CONSTRAINT "ExciseRate_valid_check" CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");
ALTER TABLE "VendorOffer" ADD CONSTRAINT "VendorOffer_abv_check" CHECK ("abv" IS NULL OR ("abv" >= 0 AND "abv" <= 100));
ALTER TABLE "VendorOffer" ADD CONSTRAINT "VendorOffer_excise_measures_check" CHECK (("volumeL" IS NULL OR "volumeL" > 0) AND ("exciseUnits" IS NULL OR "exciseUnits" > 0) AND ("netKg" IS NULL OR "netKg" > 0) AND ("sugarGPerL" IS NULL OR "sugarGPerL" >= 0));
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_excise_check" CHECK ("exciseNet" >= 0);

INSERT INTO "ExciseCategory" (id, code, name, kind, basis, "sortOrder", "updatedAt") VALUES
 ('ec_beer', 'BEER', '{"en":"Beer","pt":"Cerveja","es":"Cerveza"}', 'ALCOHOL', 'HL_PER_ABV', 1, now()),
 ('ec_wine', 'WINE', '{"en":"Wine","pt":"Vinho","es":"Vino"}', 'ALCOHOL', 'HL_PRODUCT', 2, now()),
 ('ec_intermediate', 'INTERMEDIATE', '{"en":"Intermediate products (port, sherry…)","pt":"Produtos intermédios (vinho do Porto…)","es":"Productos intermedios (jerez…)"}', 'ALCOHOL', 'HL_PRODUCT', 3, now()),
 ('ec_spirits', 'SPIRITS', '{"en":"Spirits","pt":"Bebidas espirituosas","es":"Bebidas espirituosas"}', 'ALCOHOL', 'HL_PURE_ALCOHOL', 4, now()),
 ('ec_cigarettes', 'CIGARETTES', '{"en":"Cigarettes","pt":"Cigarros","es":"Cigarrillos"}', 'TOBACCO', 'THOUSAND_UNITS', 5, now()),
 ('ec_cigars', 'CIGARS', '{"en":"Cigars and cigarillos","pt":"Charutos e cigarrilhas","es":"Puros y puritos"}', 'TOBACCO', 'THOUSAND_UNITS', 6, now()),
 ('ec_rolling_tobacco', 'ROLLING_TOBACCO', '{"en":"Rolling tobacco","pt":"Tabaco de enrolar","es":"Tabaco de liar"}', 'TOBACCO', 'KG', 7, now()),
 ('ec_e_liquid', 'E_LIQUID', '{"en":"E-liquids","pt":"Líquidos para cigarros eletrónicos","es":"Líquidos para cigarrillos electrónicos"}', 'VAPING', 'ML', 8, now()),
 ('ec_sugar_drink', 'SUGAR_DRINK', '{"en":"Sugar-sweetened drinks","pt":"Bebidas açucaradas","es":"Bebidas azucaradas"}', 'SUGAR', 'HL_SUGAR_BAND', 9, now());

-- Example rates (check against the official tables before going live).
INSERT INTO "ExciseRate" (id, "categoryId", "countryCode", rate, "adValoremPct", bands, "validFrom", note) VALUES
 ('er_pt_beer', 'ec_beer', 'PT', 4.5, NULL, NULL, '2026-01-01', 'IABA cerveja (exemplo, € / hl / % vol)'),
 ('er_pt_wine', 'ec_wine', 'PT', 0, NULL, NULL, '2026-01-01', 'Vinho: taxa zero'),
 ('er_pt_intermediate', 'ec_intermediate', 'PT', 80.29, NULL, NULL, '2026-01-01', 'Produtos intermédios (exemplo)'),
 ('er_pt_spirits', 'ec_spirits', 'PT', 1476.15, NULL, NULL, '2026-01-01', 'Bebidas espirituosas (exemplo, € / hl de álcool puro)'),
 ('er_pt_cigarettes', 'ec_cigarettes', 'PT', 117.27, 14, NULL, '2026-01-01', 'Imposto sobre o tabaco — específico + ad valorem (exemplo)'),
 ('er_pt_cigars', 'ec_cigars', 'PT', 90, 25, NULL, '2026-01-01', 'Charutos (exemplo)'),
 ('er_pt_rolling', 'ec_rolling_tobacco', 'PT', 80, 20, NULL, '2026-01-01', 'Tabaco de enrolar (exemplo, € / kg)'),
 ('er_pt_eliquid', 'ec_e_liquid', 'PT', 0.33, NULL, NULL, '2026-01-01', 'Líquidos com nicotina (exemplo, € / ml)'),
 ('er_pt_sugar', 'ec_sugar_drink', 'PT', 0, NULL, '[{"maxGPerL":25,"perHl":1.13},{"maxGPerL":50,"perHl":6.89},{"maxGPerL":80,"perHl":9.1},{"maxGPerL":null,"perHl":22.76}]', '2026-01-01', 'IABA bebidas açucaradas por escalão (exemplo)'),
 ('er_es_beer', 'ec_beer', 'ES', 9.96, NULL, NULL, '2026-01-01', 'Impuesto sobre la cerveza (ejemplo)'),
 ('er_es_wine', 'ec_wine', 'ES', 0, NULL, NULL, '2026-01-01', 'Vino: tipo cero'),
 ('er_es_intermediate', 'ec_intermediate', 'ES', 61.45, NULL, NULL, '2026-01-01', 'Productos intermedios (ejemplo)'),
 ('er_es_spirits', 'ec_spirits', 'ES', 958.94, NULL, NULL, '2026-01-01', 'Alcohol y bebidas derivadas (ejemplo)'),
 ('er_es_cigarettes', 'ec_cigarettes', 'ES', 24.1, 51, NULL, '2026-01-01', 'Labores del tabaco (ejemplo)'),
 ('er_es_rolling', 'ec_rolling_tobacco', 'ES', 26.5, 41.5, NULL, '2026-01-01', 'Picadura para liar (ejemplo)'),
 ('er_es_eliquid', 'ec_e_liquid', 'ES', 0.15, NULL, NULL, '2026-01-01', 'Líquidos (ejemplo)');

INSERT INTO "LicenceType" (id, code, name, kinds, countries, "sortOrder", "updatedAt") VALUES
 ('lt_alcohol', 'ALCOHOL_SALE', '{"en":"Licence to sell alcoholic drinks","pt":"Licença de venda de bebidas alcoólicas","es":"Licencia de venta de bebidas alcohólicas"}', ARRAY['ALCOHOL']::"ExciseKind"[], '{}', 1, now()),
 ('lt_tobacco', 'TOBACCO_SALE', '{"en":"Licence to sell tobacco and vaping products","pt":"Licença de venda de tabaco e cigarros eletrónicos","es":"Licencia de venta de tabaco y productos de vapeo"}', ARRAY['TOBACCO','VAPING']::"ExciseKind"[], '{}', 2, now());

UPDATE "Category" SET "exciseCategoryId" = 'ec_beer' WHERE slug = 'beer';
UPDATE "Category" SET "exciseCategoryId" = 'ec_wine' WHERE slug = 'wine';
UPDATE "Category" SET "exciseCategoryId" = 'ec_spirits' WHERE slug = 'spirits';
UPDATE "Category" SET "exciseCategoryId" = 'ec_cigarettes' WHERE slug = 'cigarettes';
UPDATE "Category" SET "exciseCategoryId" = 'ec_rolling_tobacco' WHERE slug = 'rolling-tobacco';
UPDATE "Category" SET "exciseCategoryId" = 'ec_sugar_drink' WHERE slug = 'soft-drinks';

-- Suppliers of licensed goods: their excise authorisation (Phase 28 certificate; FIRINGI makes it required)
INSERT INTO "CertificateType" (id, key, name, description, "appliesTo", "countryIds", "categoryIds", required, "needsNumber", "hasExpiry", "isActive", "sortOrder", "updatedAt")
SELECT 'ct_excise_authorisation', 'excise-authorisation', 'Excise authorisation (tax warehouse / registered consignee number)',
  'Needed to sell alcohol, tobacco and vaping products on FIRINGI.', ARRAY['DISTRIBUTOR','WHOLESALER']::"CompanyType"[], '{}',
  COALESCE((SELECT array_agg(id) FROM "Category" WHERE slug IN ('beer','wine','spirits','cigarettes','rolling-tobacco')), '{}'), false, true, true, true, 90, now()
WHERE NOT EXISTS (SELECT 1 FROM "CertificateType" WHERE key = 'excise-authorisation');
