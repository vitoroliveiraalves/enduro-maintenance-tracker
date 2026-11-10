ALTER TABLE "bikes" ADD COLUMN IF NOT EXISTS "vehicle_type" text DEFAULT 'motorcycle' NOT NULL;
ALTER TABLE "bikes" ADD COLUMN IF NOT EXISTS "plate" text;
