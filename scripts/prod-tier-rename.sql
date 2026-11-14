-- Tier rename migration: MONTHLY/YEARLY/PREMIUM -> STARTER/GROWTH/ENTERPRISE
-- (landing pricing: all monthly — Starter ৳500, Growth ৳1000, Enterprise custom).
--
-- Run in the Supabase SQL Editor. PART 1 must run FIRST as standalone
-- statements (Postgres forbids ALTER TYPE ... ADD VALUE inside a
-- transaction). PART 2 runs after, in one transaction. Safe to re-run:
-- every statement is guarded (IF NOT EXISTS / WHERE filters).
--
-- ============================ PART 1 (run first) ============================
ALTER TYPE "SubscriptionTier" ADD VALUE IF NOT EXISTS 'STARTER';
ALTER TYPE "SubscriptionTier" ADD VALUE IF NOT EXISTS 'GROWTH';
ALTER TYPE "SubscriptionTier" ADD VALUE IF NOT EXISTS 'ENTERPRISE';

-- ============================ PART 2 (one transaction) ======================
BEGIN;

UPDATE "Merchant"
SET "subscriptionTier" = 'STARTER'
WHERE "subscriptionTier" = 'MONTHLY';

UPDATE "Merchant"
SET "subscriptionTier" = 'GROWTH'
WHERE "subscriptionTier" = 'YEARLY';

UPDATE "Merchant"
SET "subscriptionTier" = 'ENTERPRISE'
WHERE "subscriptionTier" = 'PREMIUM';

UPDATE "PaymentRequest"
SET "requestedTier" = 'STARTER'
WHERE "requestedTier" = 'MONTHLY';

UPDATE "PaymentRequest"
SET "requestedTier" = 'GROWTH'
WHERE "requestedTier" = 'YEARLY';

UPDATE "PaymentRequest"
SET "requestedTier" = 'ENTERPRISE'
WHERE "requestedTier" = 'PREMIUM';

ALTER TABLE "PaymentRequest"
ALTER COLUMN "requestedTier" SET DEFAULT 'STARTER';

-- Drop the retired labels from the enum (recreate-and-swap: Postgres has no
-- DROP VALUE). Only safe because every row above was remapped first.
CREATE TYPE "SubscriptionTier_new" AS ENUM ('FREE', 'STARTER', 'GROWTH', 'ENTERPRISE');

ALTER TABLE "Merchant"
ALTER COLUMN "subscriptionTier" TYPE "SubscriptionTier_new"
USING "subscriptionTier"::text::"SubscriptionTier_new";

ALTER TABLE "PaymentRequest"
ALTER COLUMN "requestedTier" TYPE "SubscriptionTier_new"
USING "requestedTier"::text::"SubscriptionTier_new";

DROP TYPE "SubscriptionTier";

ALTER TYPE "SubscriptionTier_new" RENAME TO "SubscriptionTier";

COMMIT;

-- Verify (expect only FREE/STARTER/GROWTH/ENTERPRISE, and no MONTHLY default):
-- SELECT DISTINCT "subscriptionTier" FROM "Merchant";
-- SELECT DISTINCT "requestedTier" FROM "PaymentRequest";
-- SELECT column_default FROM information_schema.columns
--   WHERE table_name = 'PaymentRequest' AND column_name = 'requestedTier';
