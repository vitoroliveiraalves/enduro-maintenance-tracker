ALTER TABLE "meter_readings" ALTER COLUMN "hours_tenths" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meter_readings" ALTER COLUMN "km" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bikes" ADD COLUMN "meters" text DEFAULT 'hours_km' NOT NULL;