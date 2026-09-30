-- Loyl Supabase schema — paste into Supabase Dashboard → SQL Editor → New query → Run.
-- Generated from backend/prisma/schema.prisma (prisma migrate diff --from-empty).

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('DISCOUNT', 'FREE_ITEM', 'CUSTOM');

-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('STAMP', 'SCRATCH', 'DICE');

-- CreateEnum
CREATE TYPE "ScratchMode" AS ENUM ('FIXED', 'RANDOM_POOL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ScanRequestStatus" AS ENUM ('PENDING', 'APPROVED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BKASH', 'NAGAD');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'MONTHLY', 'YEARLY', 'PREMIUM');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('SCAN', 'REVIEW_BONUS', 'REDEEM');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "MenuModifierSelection" AS ENUM ('SINGLE', 'MULTI');

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "cognitoSub" TEXT,
    "businessName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "logoUrl" TEXT,
    "websiteUrl" TEXT,
    "facebookUrl" TEXT,
    "instagramUrl" TEXT,
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "subscriptionTier" "SubscriptionTier" NOT NULL DEFAULT 'FREE',
    "subscriptionExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "offerType" "OfferType" NOT NULL DEFAULT 'STAMP',
    "rewardType" "RewardType" NOT NULL DEFAULT 'DISCOUNT',
    "requiredStamps" INTEGER,
    "scratchMode" "ScratchMode",
    "scratchCursor" INTEGER NOT NULL DEFAULT 0,
    "scratchOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scratchCooldownHours" INTEGER NOT NULL DEFAULT 24,
    "diceCount" INTEGER,
    "durationDays" INTEGER NOT NULL,
    "posterTemplateUrl" TEXT,
    "finalPosterUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScratchItem" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScratchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScratchResult" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "rewardLabel" TEXT NOT NULL,
    "mode" "ScratchMode" NOT NULL,
    "scratchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScratchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiceRollResult" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "diceCount" INTEGER NOT NULL,
    "diceValues" INTEGER[],
    "total" INTEGER NOT NULL,
    "discountPercent" INTEGER NOT NULL,
    "rolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiceRollResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerStamp" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerName" TEXT,
    "stampsCollected" INTEGER NOT NULL DEFAULT 0,
    "totalRedeemed" INTEGER NOT NULL DEFAULT 0,
    "lastScannedAt" TIMESTAMP(3),
    "lastReviewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerStamp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'BKASH',
    "senderNumber" TEXT,
    "trxId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "requestedTier" "SubscriptionTier" NOT NULL DEFAULT 'MONTHLY',
    "screenshotPath" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "offerId" TEXT,
    "customerPhone" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantDevice" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "installId" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MerchantDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanRequest" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "status" "ScanRequestStatus" NOT NULL DEFAULT 'PENDING',
    "customerName" TEXT,
    "distanceMeters" INTEGER,
    "branchName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "approvedByDeviceId" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ScanRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitalMenu" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "backgroundHex" TEXT NOT NULL DEFAULT '#FFFFFF',
    "photoPath" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DigitalMenu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuCategory" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuModifierGroup" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "selectionType" "MenuModifierSelection" NOT NULL DEFAULT 'SINGLE',
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuModifierOption" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuModifierOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_cognitoSub_key" ON "Merchant"("cognitoSub");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_phoneNumber_key" ON "Merchant"("phoneNumber");

-- CreateIndex
CREATE INDEX "Merchant_phoneNumber_idx" ON "Merchant"("phoneNumber");

-- CreateIndex
CREATE INDEX "Branch_merchantId_idx" ON "Branch"("merchantId");

-- CreateIndex
CREATE INDEX "Offer_merchantId_idx" ON "Offer"("merchantId");

-- CreateIndex
CREATE INDEX "ScratchItem_offerId_idx" ON "ScratchItem"("offerId");

-- CreateIndex
CREATE INDEX "ScratchResult_offerId_customerPhone_idx" ON "ScratchResult"("offerId", "customerPhone");

-- CreateIndex
CREATE INDEX "ScratchResult_merchantId_idx" ON "ScratchResult"("merchantId");

-- CreateIndex
CREATE INDEX "DiceRollResult_merchantId_idx" ON "DiceRollResult"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "DiceRollResult_offerId_customerPhone_key" ON "DiceRollResult"("offerId", "customerPhone");

-- CreateIndex
CREATE INDEX "CustomerStamp_merchantId_idx" ON "CustomerStamp"("merchantId");

-- CreateIndex
CREATE INDEX "CustomerStamp_customerPhone_idx" ON "CustomerStamp"("customerPhone");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerStamp_merchantId_customerPhone_key" ON "CustomerStamp"("merchantId", "customerPhone");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_trxId_key" ON "PaymentRequest"("trxId");

-- CreateIndex
CREATE INDEX "PaymentRequest_merchantId_idx" ON "PaymentRequest"("merchantId");

-- CreateIndex
CREATE INDEX "PaymentRequest_status_idx" ON "PaymentRequest"("status");

-- CreateIndex
CREATE INDEX "ActivityEvent_merchantId_createdAt_idx" ON "ActivityEvent"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_merchantId_offerId_idx" ON "ActivityEvent"("merchantId", "offerId");

-- CreateIndex
CREATE INDEX "MerchantDevice_merchantId_status_idx" ON "MerchantDevice"("merchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantDevice_merchantId_installId_key" ON "MerchantDevice"("merchantId", "installId");

-- CreateIndex
CREATE INDEX "ScanRequest_merchantId_status_idx" ON "ScanRequest"("merchantId", "status");

-- CreateIndex
CREATE INDEX "ScanRequest_merchantId_customerPhone_idx" ON "ScanRequest"("merchantId", "customerPhone");

-- CreateIndex
CREATE INDEX "ScanRequest_offerId_idx" ON "ScanRequest"("offerId");

-- CreateIndex
CREATE INDEX "ScanRequest_approvedByDeviceId_idx" ON "ScanRequest"("approvedByDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "DigitalMenu_merchantId_key" ON "DigitalMenu"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "DigitalMenu_slug_key" ON "DigitalMenu"("slug");

-- CreateIndex
CREATE INDEX "DigitalMenu_merchantId_idx" ON "DigitalMenu"("merchantId");

-- CreateIndex
CREATE INDEX "MenuCategory_menuId_idx" ON "MenuCategory"("menuId");

-- CreateIndex
CREATE INDEX "MenuItem_categoryId_idx" ON "MenuItem"("categoryId");

-- CreateIndex
CREATE INDEX "MenuModifierGroup_itemId_idx" ON "MenuModifierGroup"("itemId");

-- CreateIndex
CREATE INDEX "MenuModifierOption_groupId_idx" ON "MenuModifierOption"("groupId");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScratchItem" ADD CONSTRAINT "ScratchItem_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScratchResult" ADD CONSTRAINT "ScratchResult_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScratchResult" ADD CONSTRAINT "ScratchResult_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiceRollResult" ADD CONSTRAINT "DiceRollResult_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiceRollResult" ADD CONSTRAINT "DiceRollResult_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerStamp" ADD CONSTRAINT "CustomerStamp_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantDevice" ADD CONSTRAINT "MerchantDevice_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanRequest" ADD CONSTRAINT "ScanRequest_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanRequest" ADD CONSTRAINT "ScanRequest_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanRequest" ADD CONSTRAINT "ScanRequest_approvedByDeviceId_fkey" FOREIGN KEY ("approvedByDeviceId") REFERENCES "MerchantDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalMenu" ADD CONSTRAINT "DigitalMenu_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCategory" ADD CONSTRAINT "MenuCategory_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "DigitalMenu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MenuCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuModifierGroup" ADD CONSTRAINT "MenuModifierGroup_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuModifierOption" ADD CONSTRAINT "MenuModifierOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MenuModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
