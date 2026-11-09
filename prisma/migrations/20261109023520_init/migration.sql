-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SellerType" AS ENUM ('DISTRIBUTOR', 'WHOLESALER');

-- CreateEnum
CREATE TYPE "PriceListScope" AS ENUM ('BASE', 'CUSTOMER_GROUP', 'CUSTOMER', 'CONTRACT');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'ADJUSTMENT', 'RESERVE', 'RELEASE', 'SHIPMENT', 'RETURN');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENT', 'FIXED_PER_UNIT', 'FIXED_PER_ORDER');

-- CreateEnum
CREATE TYPE "PromotionOwner" AS ENUM ('VENDOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "PromotionKind" AS ENUM ('PERCENT', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "AcceptanceStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ServiceAreaType" AS ENUM ('COUNTRY', 'REGION', 'CITY', 'ZONE', 'RADIUS_KM');

-- CreateEnum
CREATE TYPE "DeliveryRuleScope" AS ENUM ('COUNTRY', 'ZONE', 'VENDOR', 'VENDOR_AREA');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'MAINTENANCE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DriverAvailability" AS ENUM ('AVAILABLE', 'BUSY', 'OFF_DUTY');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('UNASSIGNED', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('ADMIN', 'DISTRIBUTOR', 'WHOLESALER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INVITED', 'DISABLED');

-- CreateEnum
CREATE TYPE "PermissionAudience" AS ENUM ('ADMIN', 'VENDOR', 'BUYER', 'COMPANY', 'DRIVER');

-- CreateEnum
CREATE TYPE "InvoiceDocType" AS ENUM ('INVOICE', 'INVOICE_RECEIPT', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_CREDITED', 'CREDITED');

-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('DOMESTIC', 'INTRA_EU_REVERSE_CHARGE', 'EXEMPT');

-- CreateEnum
CREATE TYPE "BillingStatementStatus" AS ENUM ('OPEN', 'INVOICED', 'MATCHED', 'DISPUTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "VendorInvoiceStatus" AS ENUM ('SUBMITTED', 'MATCHED', 'DISPUTED', 'APPROVED', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'CREDITED');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'CARD', 'MB_WAY', 'MULTIBANCO', 'DIRECT_DEBIT', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "AddressKind" AS ENUM ('HEAD_OFFICE', 'BILLING', 'WAREHOUSE', 'PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('BUSINESS_REGISTRATION', 'TAX_ID_CERTIFICATE', 'TRADE_LICENCE', 'TOBACCO_LICENCE', 'ALCOHOL_LICENCE', 'ID_DOCUMENT', 'DRIVING_LICENCE', 'VEHICLE_REGISTRATION', 'VEHICLE_INSURANCE', 'SELF_BILLING_AGREEMENT', 'CONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "Restriction" AS ENUM ('TOBACCO', 'ALCOHOL');

-- CreateEnum
CREATE TYPE "VatValidationResult" AS ENUM ('VALID', 'INVALID', 'ERROR');

-- CreateEnum
CREATE TYPE "OrderFlow" AS ENUM ('CUSTOMER_FROM_WHOLESALER', 'WHOLESALER_FROM_DISTRIBUTOR');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'PENDING_CONFIRMATION', 'SUPPLIER_PROCESSING', 'READY_FOR_PICKUP', 'DISPATCHED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURNED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('VENDOR_FLEET', 'FIRINGI_FLEET', 'CARRIER');

-- CreateEnum
CREATE TYPE "SettingScope" AS ENUM ('GLOBAL', 'COUNTRY', 'COMPANY');

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" JSONB NOT NULL,
    "slug" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "restriction" "Restriction",
    "defaultTaxCategoryId" TEXT,
    "imageKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "brandId" TEXT,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "images" TEXT[],
    "taxCategoryId" TEXT NOT NULL,
    "restriction" "Restriction",
    "hsCode" TEXT,
    "originCountryCode" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "proposedByCompanyId" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "gtin" TEXT,
    "attributes" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitOfMeasure" (
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,

    CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "PackagingUnit" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "uomCode" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "unitsPerPack" INTEGER NOT NULL DEFAULT 1,
    "gtin" TEXT,
    "netWeightKg" DECIMAL(10,3),
    "grossWeightKg" DECIMAL(10,3),
    "dimensionsCm" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PackagingUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorOffer" (
    "id" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "sellerType" "SellerType" NOT NULL,
    "packagingUnitId" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "vendorSku" TEXT,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "minOrderQty" INTEGER NOT NULL DEFAULT 1,
    "qtyStep" INTEGER NOT NULL DEFAULT 1,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerGroup" (
    "id" TEXT NOT NULL,
    "ownerCompanyId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerGroupMember" (
    "groupId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerGroupMember_pkey" PRIMARY KEY ("groupId","companyId")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "PriceListScope" NOT NULL,
    "targetGroupId" TEXT,
    "targetCompanyId" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "countryId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "minQty" INTEGER NOT NULL DEFAULT 1,
    "unitPriceNet" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "qty" INTEGER NOT NULL,
    "orderId" TEXT,
    "note" TEXT,
    "byUserId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "type" "CommissionType" NOT NULL DEFAULT 'PERCENT',
    "categoryId" TEXT,
    "rate" DECIMAL(10,4) NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "ownerType" "PromotionOwner" NOT NULL,
    "ownerCompanyId" TEXT,
    "name" JSONB NOT NULL,
    "kind" "PromotionKind" NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "firingiFundPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vendorFundPct" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "countryId" TEXT,
    "minQty" INTEGER,
    "minOrderValue" DECIMAL(18,2),
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "requiresVendorAcceptance" BOOLEAN NOT NULL DEFAULT false,
    "budget" DECIMAL(18,2),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionTarget" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "offerId" TEXT,
    "productId" TEXT,
    "categoryId" TEXT,
    "vendorCompanyId" TEXT,
    "customerGroupId" TEXT,

    CONSTRAINT "PromotionTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionVendorAcceptance" (
    "promotionId" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "status" "AcceptanceStatus" NOT NULL DEFAULT 'PENDING',
    "respondedById" TEXT,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "PromotionVendorAcceptance_pkey" PRIMARY KEY ("promotionId","vendorCompanyId")
);

-- CreateTable
CREATE TABLE "DeliveryZone" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "postalCodePatterns" TEXT[],
    "polygon" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorServiceArea" (
    "id" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "type" "ServiceAreaType" NOT NULL,
    "countryId" TEXT NOT NULL,
    "regionId" TEXT,
    "cityId" TEXT,
    "zoneId" TEXT,
    "originAddressId" TEXT,
    "radiusKm" DECIMAL(8,2),
    "ownFleet" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorServiceArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRule" (
    "id" TEXT NOT NULL,
    "scope" "DeliveryRuleScope" NOT NULL,
    "countryId" TEXT NOT NULL,
    "zoneId" TEXT,
    "vendorCompanyId" TEXT,
    "serviceAreaId" TEXT,
    "minOrderValue" DECIMAL(18,2) NOT NULL,
    "freeDeliveryThreshold" DECIMAL(18,2) NOT NULL,
    "firingiDeliveryFeeNet" DECIMAL(18,2) NOT NULL,
    "feeTaxCategoryId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "ownerCompanyId" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "capacityKg" DECIMAL(10,2),
    "capacityM3" DECIMAL(10,2),
    "isRefrigerated" BOOLEAN NOT NULL DEFAULT false,
    "status" "VehicleStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ownerCompanyId" TEXT NOT NULL,
    "licenceNumber" TEXT NOT NULL,
    "licenceExpiry" TIMESTAMP(3),
    "status" "AccountStatus" NOT NULL DEFAULT 'PENDING',
    "availability" "DriverAvailability" NOT NULL DEFAULT 'OFF_DUTY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "mode" "DeliveryMode" NOT NULL,
    "executingCompanyId" TEXT NOT NULL,
    "driverId" TEXT,
    "vehicleId" TEXT,
    "carrierName" TEXT,
    "trackingNumber" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "scheduledFor" TIMESTAMP(3),
    "eta" TIMESTAMP(3),
    "feeNet" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "succeeded" BOOLEAN NOT NULL,
    "failureReason" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "byUserId" TEXT,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofOfDelivery" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "photoKeys" TEXT[],
    "signatureKey" TEXT,
    "recipientName" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byUserId" TEXT,

    CONSTRAINT "ProofOfDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Currency" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "baseCode" TEXT NOT NULL,
    "quoteCode" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Language" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "native" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "uiAvailable" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Language_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Country" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "flag" TEXT,
    "isEU" BOOLEAN NOT NULL DEFAULT false,
    "vatPrefix" TEXT,
    "defaultCurrencyCode" TEXT NOT NULL,
    "defaultLanguageCode" TEXT NOT NULL,
    "customerMarketEnabled" BOOLEAN NOT NULL DEFAULT false,
    "wholesalerMarketEnabled" BOOLEAN NOT NULL DEFAULT false,
    "distributorSourcingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CountryLanguage" (
    "countryId" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CountryLanguage_pkey" PRIMARY KEY ("countryId","languageCode")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "taxRegionCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,

    CONSTRAINT "TaxCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "regionId" TEXT,
    "taxCategoryId" TEXT NOT NULL,
    "taxType" TEXT NOT NULL DEFAULT 'VAT',
    "rate" DECIMAL(6,3) NOT NULL,
    "saftCode" TEXT,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxExemptionReason" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "text" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TaxExemptionReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "phone" TEXT,
    "locale" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "activeCompanyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "type" "CompanyType" NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'PENDING',
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "taxId" TEXT NOT NULL,
    "vatNumber" TEXT,
    "countryId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "website" TEXT,
    "businessType" TEXT,
    "defaultCurrencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "defaultLanguageCode" TEXT,
    "creditLimit" DECIMAL(18,2),
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "regionalManagerId" TEXT,
    "notes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "statusReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyStatusHistory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fromStatus" "AccountStatus",
    "toStatus" "AccountStatus" NOT NULL,
    "reason" TEXT,
    "byUserId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalEntity" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "taxId" TEXT NOT NULL,
    "vatNumber" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "iban" TEXT,
    "logoKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "jobTitle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipScope" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "countryId" TEXT,
    "regionId" TEXT,

    CONSTRAINT "MembershipScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "code" TEXT NOT NULL,
    "audience" "PermissionAudience" NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "appliesTo" "CompanyType"[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionCode" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionCode")
);

-- CreateTable
CREATE TABLE "MembershipRole" (
    "membershipId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,

    CONSTRAINT "MembershipRole_pkey" PRIMARY KEY ("membershipId","roleId")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "actorCompanyId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "meta" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceSeries" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "docType" "InvoiceDocType" NOT NULL,
    "prefix" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "atcudValidationCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "seriesId" TEXT,
    "docType" "InvoiceDocType" NOT NULL,
    "number" INTEGER,
    "fullNumber" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "taxRegime" "TaxRegime" NOT NULL DEFAULT 'DOMESTIC',
    "recipientCompanyId" TEXT NOT NULL,
    "issuerSnapshot" JSONB NOT NULL,
    "recipientSnapshot" JSONB NOT NULL,
    "orderId" TEXT,
    "originalInvoiceId" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "netTotal" DECIMAL(18,2) NOT NULL,
    "vatTotal" DECIMAL(18,2) NOT NULL,
    "grossTotal" DECIMAL(18,2) NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "atcud" TEXT,
    "hash" TEXT,
    "previousHash" TEXT,
    "qrPayload" TEXT,
    "externalProvider" TEXT,
    "externalId" TEXT,
    "pdfKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "orderLineId" TEXT,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "unitPriceNet" DECIMAL(18,4) NOT NULL,
    "discountNet" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(6,3) NOT NULL,
    "saftTaxCode" TEXT,
    "exemptionReasonId" TEXT,
    "lineNet" DECIMAL(18,2) NOT NULL,
    "lineVat" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceTaxSummary" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "taxRate" DECIMAL(6,3) NOT NULL,
    "base" DECIMAL(18,2) NOT NULL,
    "vat" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "InvoiceTaxSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBillingStatement" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "salesInvoiceId" TEXT,
    "isCreditStatement" BOOLEAN NOT NULL DEFAULT false,
    "taxRegime" "TaxRegime" NOT NULL DEFAULT 'DOMESTIC',
    "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "expectedNet" DECIMAL(18,2) NOT NULL,
    "expectedVat" DECIMAL(18,2) NOT NULL,
    "expectedGross" DECIMAL(18,2) NOT NULL,
    "commissionTotal" DECIMAL(18,2) NOT NULL,
    "lines" JSONB NOT NULL,
    "status" "BillingStatementStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorBillingStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorInvoice" (
    "id" TEXT NOT NULL,
    "vendorCompanyId" TEXT NOT NULL,
    "docType" "InvoiceDocType" NOT NULL DEFAULT 'INVOICE',
    "externalNumber" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "dueDate" DATE,
    "taxRegime" "TaxRegime" NOT NULL DEFAULT 'DOMESTIC',
    "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "netTotal" DECIMAL(18,2) NOT NULL,
    "vatTotal" DECIMAL(18,2) NOT NULL,
    "grossTotal" DECIMAL(18,2) NOT NULL,
    "selfAssessedVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fileKey" TEXT NOT NULL,
    "structuredData" JSONB,
    "status" "VendorInvoiceStatus" NOT NULL DEFAULT 'SUBMITTED',
    "matchResult" JSONB,
    "submittedById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorInvoiceAllocation" (
    "vendorInvoiceId" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "amountNet" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "VendorInvoiceAllocation_pkey" PRIMARY KEY ("vendorInvoiceId","statementId")
);

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT,
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnLine" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "ReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "reference" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "vendorInvoiceId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "AddressKind" NOT NULL,
    "label" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "postalCode" TEXT NOT NULL,
    "cityId" TEXT,
    "cityName" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "contactName" TEXT,
    "phone" TEXT,
    "openingHours" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "driverId" TEXT,
    "vehicleId" TEXT,
    "restrictionApprovalId" TEXT,
    "type" "DocumentType" NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestrictionApproval" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "restriction" "Restriction" NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "extraInfo" JSONB,
    "validUntil" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestrictionApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VatValidation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vatNumber" TEXT NOT NULL,
    "result" "VatValidationResult" NOT NULL,
    "registeredName" TEXT,
    "registeredAddress" TEXT,
    "consultationRef" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedById" TEXT,

    CONSTRAINT "VatValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sellerCompanyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "flow" "OrderFlow" NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "sellerCompanyId" TEXT NOT NULL,
    "placedByUserId" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "vendorCurrencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "fxRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "deliveryMode" "DeliveryMode",
    "deliveryAddress" JSONB NOT NULL,
    "sourceAddressId" TEXT,
    "deliveryRuleId" TEXT,
    "requestedDeliveryDate" TIMESTAMP(3),
    "buyerNotes" TEXT,
    "parentOrderId" TEXT,
    "listNet" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deliveryFeeNet" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "commissionTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vendorPayableNet" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "firingiMarginNet" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "productName" JSONB NOT NULL,
    "sku" TEXT NOT NULL,
    "packagingName" JSONB NOT NULL,
    "qtyOrdered" INTEGER NOT NULL,
    "qtyConfirmed" INTEGER,
    "qtyDelivered" INTEGER,
    "unitListPriceNet" DECIMAL(18,4) NOT NULL,
    "vendorDiscountNet" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "adminDiscountNet" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "firingiFundedDiscount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vendorFundedDiscount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unitSalePriceNet" DECIMAL(18,4) NOT NULL,
    "taxRate" DECIMAL(6,3) NOT NULL,
    "lineNet" DECIMAL(18,2) NOT NULL,
    "lineVat" DECIMAL(18,2) NOT NULL,
    "commissionRuleId" TEXT,
    "commissionType" "CommissionType",
    "commissionRate" DECIMAL(10,4),
    "commissionBase" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "commissionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vendorUnitCostNet" DECIMAL(18,4) NOT NULL,
    "vendorLineNet" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLineDiscount" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "firingiAmount" DECIMAL(18,2) NOT NULL,
    "vendorAmount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "OrderLineDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "reason" TEXT,
    "byUserId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderException" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "scope" "SettingScope" NOT NULL,
    "scopeId" TEXT NOT NULL DEFAULT '',
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("name","year")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileObject" (
    "key" TEXT NOT NULL,
    "ownerCompanyId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileObject_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "Category_parentId_sortOrder_idx" ON "Category"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "Category_path_idx" ON "Category"("path");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");

-- CreateIndex
CREATE INDEX "Product_categoryId_status_idx" ON "Product"("categoryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- CreateIndex
CREATE INDEX "VendorOffer_sellerType_status_countryId_idx" ON "VendorOffer"("sellerType", "status", "countryId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorOffer_vendorCompanyId_packagingUnitId_key" ON "VendorOffer"("vendorCompanyId", "packagingUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceListItem_priceListId_offerId_minQty_key" ON "PriceListItem"("priceListId", "offerId", "minQty");

-- CreateIndex
CREATE UNIQUE INDEX "StockLevel_offerId_addressId_key" ON "StockLevel"("offerId", "addressId");

-- CreateIndex
CREATE INDEX "StockMovement_offerId_at_idx" ON "StockMovement"("offerId", "at");

-- CreateIndex
CREATE INDEX "CommissionRule_vendorCompanyId_validFrom_idx" ON "CommissionRule"("vendorCompanyId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_ownerCompanyId_plate_key" ON "Vehicle"("ownerCompanyId", "plate");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_userId_key" ON "Driver"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProofOfDelivery_deliveryId_key" ON "ProofOfDelivery"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_baseCode_quoteCode_date_key" ON "ExchangeRate"("baseCode", "quoteCode", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Country_code_key" ON "Country"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Region_countryId_code_key" ON "Region"("countryId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "City_regionId_name_key" ON "City"("regionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCategory_code_key" ON "TaxCategory"("code");

-- CreateIndex
CREATE INDEX "TaxRate_countryId_taxCategoryId_validFrom_idx" ON "TaxRate"("countryId", "taxCategoryId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "TaxExemptionReason_countryId_code_key" ON "TaxExemptionReason"("countryId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Company_type_status_idx" ON "Company"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Company_countryId_taxId_type_key" ON "Company"("countryId", "taxId", "type");

-- CreateIndex
CREATE INDEX "CompanyStatusHistory_companyId_at_idx" ON "CompanyStatusHistory"("companyId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "LegalEntity_countryId_taxId_key" ON "LegalEntity"("countryId", "taxId");

-- CreateIndex
CREATE INDEX "Membership_companyId_idx" ON "Membership"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_companyId_key" ON "Membership"("userId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_companyId_key_key" ON "Role"("companyId", "key");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorCompanyId_at_idx" ON "AuditLog"("actorCompanyId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceSeries_legalEntityId_docType_prefix_year_key" ON "InvoiceSeries"("legalEntityId", "docType", "prefix", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_fullNumber_key" ON "Invoice"("fullNumber");

-- CreateIndex
CREATE INDEX "Invoice_recipientCompanyId_issuedAt_idx" ON "Invoice"("recipientCompanyId", "issuedAt");

-- CreateIndex
CREATE INDEX "Invoice_orderId_idx" ON "Invoice"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBillingStatement_number_key" ON "VendorBillingStatement"("number");

-- CreateIndex
CREATE UNIQUE INDEX "VendorInvoice_vendorCompanyId_externalNumber_key" ON "VendorInvoice"("vendorCompanyId", "externalNumber");

-- CreateIndex
CREATE INDEX "Address_companyId_kind_idx" ON "Address"("companyId", "kind");

-- CreateIndex
CREATE INDEX "Document_companyId_idx" ON "Document"("companyId");

-- CreateIndex
CREATE INDEX "Document_status_idx" ON "Document"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RestrictionApproval_companyId_restriction_key" ON "RestrictionApproval"("companyId", "restriction");

-- CreateIndex
CREATE INDEX "VatValidation_companyId_checkedAt_idx" ON "VatValidation"("companyId", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_buyerCompanyId_userId_key" ON "Cart"("buyerCompanyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_cartId_offerId_key" ON "CartItem"("cartId", "offerId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- CreateIndex
CREATE INDEX "Order_buyerCompanyId_placedAt_idx" ON "Order"("buyerCompanyId", "placedAt");

-- CreateIndex
CREATE INDEX "Order_sellerCompanyId_placedAt_idx" ON "Order"("sellerCompanyId", "placedAt");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_orderId_at_idx" ON "OrderStatusHistory"("orderId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_scope_scopeId_key_key" ON "Setting"("scope", "scopeId", "key");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_defaultTaxCategoryId_fkey" FOREIGN KEY ("defaultTaxCategoryId") REFERENCES "TaxCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_taxCategoryId_fkey" FOREIGN KEY ("taxCategoryId") REFERENCES "TaxCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_proposedByCompanyId_fkey" FOREIGN KEY ("proposedByCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagingUnit" ADD CONSTRAINT "PackagingUnit_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagingUnit" ADD CONSTRAINT "PackagingUnit_uomCode_fkey" FOREIGN KEY ("uomCode") REFERENCES "UnitOfMeasure"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorOffer" ADD CONSTRAINT "VendorOffer_vendorCompanyId_fkey" FOREIGN KEY ("vendorCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorOffer" ADD CONSTRAINT "VendorOffer_packagingUnitId_fkey" FOREIGN KEY ("packagingUnitId") REFERENCES "PackagingUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorOffer" ADD CONSTRAINT "VendorOffer_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerGroup" ADD CONSTRAINT "CustomerGroup_ownerCompanyId_fkey" FOREIGN KEY ("ownerCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerGroupMember" ADD CONSTRAINT "CustomerGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CustomerGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerGroupMember" ADD CONSTRAINT "CustomerGroupMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_vendorCompanyId_fkey" FOREIGN KEY ("vendorCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_targetGroupId_fkey" FOREIGN KEY ("targetGroupId") REFERENCES "CustomerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_targetCompanyId_fkey" FOREIGN KEY ("targetCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "VendorOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "VendorOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "VendorOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_vendorCompanyId_fkey" FOREIGN KEY ("vendorCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_ownerCompanyId_fkey" FOREIGN KEY ("ownerCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionTarget" ADD CONSTRAINT "PromotionTarget_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionTarget" ADD CONSTRAINT "PromotionTarget_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "VendorOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionTarget" ADD CONSTRAINT "PromotionTarget_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionTarget" ADD CONSTRAINT "PromotionTarget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionTarget" ADD CONSTRAINT "PromotionTarget_vendorCompanyId_fkey" FOREIGN KEY ("vendorCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionTarget" ADD CONSTRAINT "PromotionTarget_customerGroupId_fkey" FOREIGN KEY ("customerGroupId") REFERENCES "CustomerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionVendorAcceptance" ADD CONSTRAINT "PromotionVendorAcceptance_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionVendorAcceptance" ADD CONSTRAINT "PromotionVendorAcceptance_vendorCompanyId_fkey" FOREIGN KEY ("vendorCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorServiceArea" ADD CONSTRAINT "VendorServiceArea_vendorCompanyId_fkey" FOREIGN KEY ("vendorCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorServiceArea" ADD CONSTRAINT "VendorServiceArea_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorServiceArea" ADD CONSTRAINT "VendorServiceArea_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorServiceArea" ADD CONSTRAINT "VendorServiceArea_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorServiceArea" ADD CONSTRAINT "VendorServiceArea_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DeliveryZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorServiceArea" ADD CONSTRAINT "VendorServiceArea_originAddressId_fkey" FOREIGN KEY ("originAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRule" ADD CONSTRAINT "DeliveryRule_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRule" ADD CONSTRAINT "DeliveryRule_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DeliveryZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRule" ADD CONSTRAINT "DeliveryRule_vendorCompanyId_fkey" FOREIGN KEY ("vendorCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRule" ADD CONSTRAINT "DeliveryRule_serviceAreaId_fkey" FOREIGN KEY ("serviceAreaId") REFERENCES "VendorServiceArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRule" ADD CONSTRAINT "DeliveryRule_feeTaxCategoryId_fkey" FOREIGN KEY ("feeTaxCategoryId") REFERENCES "TaxCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_ownerCompanyId_fkey" FOREIGN KEY ("ownerCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_ownerCompanyId_fkey" FOREIGN KEY ("ownerCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_executingCompanyId_fkey" FOREIGN KEY ("executingCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofOfDelivery" ADD CONSTRAINT "ProofOfDelivery_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_baseCode_fkey" FOREIGN KEY ("baseCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_quoteCode_fkey" FOREIGN KEY ("quoteCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Country" ADD CONSTRAINT "Country_defaultCurrencyCode_fkey" FOREIGN KEY ("defaultCurrencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Country" ADD CONSTRAINT "Country_defaultLanguageCode_fkey" FOREIGN KEY ("defaultLanguageCode") REFERENCES "Language"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountryLanguage" ADD CONSTRAINT "CountryLanguage_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountryLanguage" ADD CONSTRAINT "CountryLanguage_languageCode_fkey" FOREIGN KEY ("languageCode") REFERENCES "Language"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_taxCategoryId_fkey" FOREIGN KEY ("taxCategoryId") REFERENCES "TaxCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxExemptionReason" ADD CONSTRAINT "TaxExemptionReason_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_regionalManagerId_fkey" FOREIGN KEY ("regionalManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyStatusHistory" ADD CONSTRAINT "CompanyStatusHistory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipScope" ADD CONSTRAINT "MembershipScope_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipScope" ADD CONSTRAINT "MembershipScope_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipScope" ADD CONSTRAINT "MembershipScope_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "Permission"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRole" ADD CONSTRAINT "MembershipRole_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRole" ADD CONSTRAINT "MembershipRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceSeries" ADD CONSTRAINT "InvoiceSeries_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceSeries" ADD CONSTRAINT "InvoiceSeries_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "InvoiceSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_recipientCompanyId_fkey" FOREIGN KEY ("recipientCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_originalInvoiceId_fkey" FOREIGN KEY ("originalInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_exemptionReasonId_fkey" FOREIGN KEY ("exemptionReasonId") REFERENCES "TaxExemptionReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceTaxSummary" ADD CONSTRAINT "InvoiceTaxSummary_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBillingStatement" ADD CONSTRAINT "VendorBillingStatement_vendorCompanyId_fkey" FOREIGN KEY ("vendorCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBillingStatement" ADD CONSTRAINT "VendorBillingStatement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBillingStatement" ADD CONSTRAINT "VendorBillingStatement_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorInvoice" ADD CONSTRAINT "VendorInvoice_vendorCompanyId_fkey" FOREIGN KEY ("vendorCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorInvoiceAllocation" ADD CONSTRAINT "VendorInvoiceAllocation_vendorInvoiceId_fkey" FOREIGN KEY ("vendorInvoiceId") REFERENCES "VendorInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorInvoiceAllocation" ADD CONSTRAINT "VendorInvoiceAllocation_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "VendorBillingStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_vendorInvoiceId_fkey" FOREIGN KEY ("vendorInvoiceId") REFERENCES "VendorInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_restrictionApprovalId_fkey" FOREIGN KEY ("restrictionApprovalId") REFERENCES "RestrictionApproval"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestrictionApproval" ADD CONSTRAINT "RestrictionApproval_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VatValidation" ADD CONSTRAINT "VatValidation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_sellerCompanyId_fkey" FOREIGN KEY ("sellerCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "VendorOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_sellerCompanyId_fkey" FOREIGN KEY ("sellerCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_placedByUserId_fkey" FOREIGN KEY ("placedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_sourceAddressId_fkey" FOREIGN KEY ("sourceAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryRuleId_fkey" FOREIGN KEY ("deliveryRuleId") REFERENCES "DeliveryRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_parentOrderId_fkey" FOREIGN KEY ("parentOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "VendorOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_commissionRuleId_fkey" FOREIGN KEY ("commissionRuleId") REFERENCES "CommissionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineDiscount" ADD CONSTRAINT "OrderLineDiscount_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineDiscount" ADD CONSTRAINT "OrderLineDiscount_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderException" ADD CONSTRAINT "OrderException_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
