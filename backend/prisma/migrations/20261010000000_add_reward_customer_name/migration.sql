-- Add sign-in name to instant-reward check-ins so the merchant customers
-- list can show a person instead of a bare phone number. Nullable so all
-- historical scratch reveals and dice rolls stay valid.
ALTER TABLE "ScratchResult" ADD COLUMN IF NOT EXISTS "customerName" TEXT;
ALTER TABLE "DiceRollResult" ADD COLUMN IF NOT EXISTS "customerName" TEXT;
