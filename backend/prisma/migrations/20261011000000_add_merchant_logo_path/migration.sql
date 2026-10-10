-- Stored merchant logo filename (bare name in the merchant-logos store).
-- When set, the public URL is /api/public/logo/<merchantId>; the legacy
-- externally-hosted logoUrl stays as fallback. Nullable so all existing
-- merchant rows stay valid.
ALTER TABLE "Merchant" ADD COLUMN IF NOT EXISTS "logoPath" TEXT;
