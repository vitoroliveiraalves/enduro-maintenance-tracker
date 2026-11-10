ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "amount_cents" integer;
ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "provider" text;
ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "policy_number" text;
