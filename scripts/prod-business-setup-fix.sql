-- Loyl production fix — business-setup INTERNAL_ERROR (2026-10-11).
--
-- Symptom:  POST /api/auth/business-setup  ->  500
--           "Failed to save business profile — please try again (ref …)"
-- Cause:    the Vercel build compiles the Prisma client from the CURRENT
--           backend/prisma/schema.prisma, but the Supabase DB predates newer
--           columns. Prisma's upsert RETURNING reads every scalar field, so a
--           single missing column (notably Merchant."logoPath", added 2026-10-11)
--           fails the whole signup even though the write never touches it.
--
-- Run: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: every statement is IF NOT EXISTS / guarded.
-- After: redeploy `loyl` on Vercel (or just retry signup — the route hotfix
-- in this same change already narrows its RETURNING, this patch syncs the DB
-- so dashboard/analytics/customers work too).

-- 1) New enums ---------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "SecurityAlertKind" AS ENUM ('APPROVAL_BURST', 'DEVICE_REGISTERED', 'DEVICE_REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) Merchant: columns added after the original supabase-schema.sql ------------
ALTER TABLE "Merchant" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "Merchant" ADD COLUMN IF NOT EXISTS "firebaseUid" TEXT;
ALTER TABLE "Merchant" ADD COLUMN IF NOT EXISTS "logoPath" TEXT;

DO $$ BEGIN
  ALTER TABLE "Merchant" ADD CONSTRAINT "Merchant_email_key" UNIQUE ("email");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Merchant" ADD CONSTRAINT "Merchant_firebaseUid_key" UNIQUE ("firebaseUid");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "Merchant_email_key" ON "Merchant"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "Merchant_firebaseUid_key" ON "Merchant"("firebaseUid");
CREATE INDEX IF NOT EXISTS "Merchant_email_idx" ON "Merchant"("email");

-- 3) ScanRequest.pendingKey (race guard, added Sep 2025) -----------------------
ALTER TABLE "ScanRequest" ADD COLUMN IF NOT EXISTS "pendingKey" TEXT;
DO $$ BEGIN
  ALTER TABLE "ScanRequest" ADD CONSTRAINT "ScanRequest_pendingKey_key" UNIQUE ("pendingKey");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "ScanRequest_pendingKey_key" ON "ScanRequest"("pendingKey");

-- 4) Customer-name snapshots (added Sep 2025) ----------------------------------
ALTER TABLE "ScratchResult" ADD COLUMN IF NOT EXISTS "customerName" TEXT;
ALTER TABLE "DiceRollResult" ADD COLUMN IF NOT EXISTS "customerName" TEXT;

-- 5) RT-02 append-only admin audit trail (Oct 2025) ----------------------------
CREATE TABLE IF NOT EXISTS "AdminAction" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "actorId" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AdminAction_createdAt_idx" ON "AdminAction"("createdAt");
CREATE INDEX IF NOT EXISTS "AdminAction_action_idx" ON "AdminAction"("action");
CREATE INDEX IF NOT EXISTS "AdminAction_targetType_targetId_idx" ON "AdminAction"("targetType", "targetId");

-- 6) RT-03 security alerts (Oct 2025) ------------------------------------------
CREATE TABLE IF NOT EXISTS "SecurityAlert" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "kind" "SecurityAlertKind" NOT NULL,
    "deviceId" TEXT,
    "message" TEXT NOT NULL,
    "count" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecurityAlert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SecurityAlert_merchantId_createdAt_idx" ON "SecurityAlert"("merchantId", "createdAt");
CREATE INDEX IF NOT EXISTS "SecurityAlert_merchantId_kind_idx" ON "SecurityAlert"("merchantId", "kind");
DO $$ BEGIN
  ALTER TABLE "SecurityAlert" ADD CONSTRAINT "SecurityAlert_merchantId_fkey"
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 7) Verify -------------------------------------------------------------------
-- Expect one row, all true:
-- SELECT
--   (SELECT count(*) = 3 FROM information_schema.columns
--      WHERE table_name = 'Merchant' AND column_name IN ('email','firebaseUid','logoPath')) AS merchant_cols_ok,
--   (SELECT to_regclass('public."AdminAction"') IS NOT NULL) AS admin_action_ok,
--   (SELECT to_regclass('public."SecurityAlert"') IS NOT NULL) AS security_alert_ok;
